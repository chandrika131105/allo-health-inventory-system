# Production-Grade Multi-Warehouse Inventory Reservation Platform

This is a production-ready implementation of a multi-warehouse e-commerce inventory reservation and checkout platform. Built using Next.js App Router, TypeScript, Prisma ORM, PostgreSQL, and Upstash Redis.

---

## 1. System Architecture & Design Overview

This system utilizes a **layered architecture** to decouple concerns:

- **Routing Layer (`src/app/api/`)**: Validates payloads via Zod, checks and writes idempotency states to Upstash Redis, handles dynamic router parameters, and maps errors to standardized JSON responses.
- **Service Layer (`src/lib/services/`)**: Encapsulates pure business logic (Inventory and Reservation services) and controls transaction boundaries.
- **Data Access Layer (`prisma/`)**: Declares entity schemas, composite indexes, relational mappings, and executes database migrations.
- **Presentation Layer (`src/app/` & `src/components/`)**: Visualizes product details, live stock counters, responsive countdown clocks, disabled button states during network roundtrips, and toast alerts.

---

## 2. Concurrency Control & Row-Level Locking

The core requirement of this platform is **race-condition safety**: under high concurrency, it is mathematically impossible to oversell stock.

### 2.1 The Race Condition Problem
If two users attempt to reserve the last unit of a product concurrently, a naive checkout process would allow both to check stock availability before either has completed updating the database. Both see a stock level of 1, both write reservations, and the stock is oversold.

### 2.2 The Solution: Pessimistic Locking (`SELECT FOR UPDATE`)
We lock the inventory row at the database engine level during reservations:
```typescript
const [inventory] = await tx.$queryRawUnsafe<Inventory[]>(
  `SELECT * FROM "Inventory" WHERE "productId" = $1 AND "warehouseId" = $2 LIMIT 1 FOR UPDATE`,
  productId,
  warehouseId
);
```

### 2.3 Why Pessimistic Locking is Preferred Over Optimistic Locking
- **Contention Degradation**: Under heavy traffic (such as a hyped flash sale or product drop), optimistic locking (e.g. using `version` columns) causes high rates of transaction rollbacks because multiple threads attempt to write to the same version.
- **Retry Overhead**: Handling optimistic locking failures requires application-level retry loops, which add substantial latency and database query overhead.
- **Deterministic Queuing**: Pessimistic locking blocks concurrent reads on the database engine. The transactions queue up cleanly. When the first transaction commits (incrementing `reservedQuantity`), the next transaction resumes, reads the *updated* row values immediately, detects that `availableQuantity` is now 0, and aborts with a clean `409 Conflict`.

### 2.4 Transaction Isolation
- We use PostgreSQL's default `READ COMMITTED` isolation level.
- By combining `READ COMMITTED` with `SELECT FOR UPDATE`, we acquire exclusive write locks on specific rows. This guarantees that all updates to a single product's inventory are executed sequentially, without having to use the high-overhead `SERIALIZABLE` isolation level which causes high transaction failures.

### 2.5 Deadlock Prevention
Deadlocks occur when two transactions are blocked, each waiting for a lock held by the other. We minimize this in production by:
1. **Consistent Lock Ordering**: Across confirm, release, and cron-cleanup flows, we always lock the `Reservation` row first and then lock the corresponding `Inventory` row.
2. **Short-Lived Transactions**: We do not perform any external network calls (such as contacting Upstash Redis or a payment provider like Stripe) inside a database transaction callback.

---

## 3. Stock Calculations & Reservation Lifecycle

### 3.1 Dynamic Stock Calculation
To prevent synchronization bugs and out-of-sync states, `availableQuantity` is computed dynamically on the fly:
$$\text{availableQuantity} = \text{totalQuantity} - \text{reservedQuantity}$$

### 3.2 Mutual Exclusion of Lifecycle States
Every state transition (pending $\rightarrow$ confirmed, pending $\rightarrow$ released, pending $\rightarrow$ expired) locks both the `Reservation` and `Inventory` rows `FOR UPDATE`.
- If a user clicks **Confirm** at the exact millisecond the background cron job attempts to **Expire** the reservation:
  - **If the Cron acquires the lock first**: It updates the status to `EXPIRED` and decrements `reservedQuantity` on `Inventory`. When the user's transaction gets the lock next, it reads status `EXPIRED`, aborts, and returns `410 Gone`.
  - **If the User acquires the lock first**: It updates status to `CONFIRMED` and decrements both `totalQuantity` and `reservedQuantity` on `Inventory`. The cron gets the lock next, reads status `CONFIRMED`, and skips the row.
  - This guarantees that stock is never double-decremented or leaked.

---

## 4. Active + Lazy Expiry Cleanup

To clean up abandoned reservations, we implement a hybrid **Active-Lazy** cleanup strategy:

1. **Active Cleanup (Vercel Cron)**: A cron job hits `/api/cron/cleanup` every 1 minute. It locks and transitions all pending reservations where `expiresAt < NOW()` to `EXPIRED`, returning their stock allocations back to the available pool.
2. **Lazy Cleanup (Application Fail-Safe)**: If a user attempts to confirm a reservation that has expired but has not yet been swept by the 1-minute cron, the confirm route checks the date on the locked row. If `expiresAt < NOW()`, it internally runs the expiration rollback and returns `410 Gone` to the client.
- **Why?** Background cron processes are eventually consistent (they run periodically). Lazy cleanup ensures that no expired reservation is ever confirmed, filling the gap between cron intervals.

---

## 5. Redis-Based Idempotency

Mutations (`POST /api/reservations` and `POST /api/reservations/:id/confirm`) support the `Idempotency-Key` header:
1. **Check**: The request checks Upstash Redis for the key. If it exists:
   - If value is `"IN_PROGRESS"`, return `409 Conflict` (request is currently executing).
   - If value is a JSON string, return the cached HTTP response (status code and payload) immediately.
2. **Execute**: If the key is not in Redis, we write `"IN_PROGRESS"` with a 5-minute TTL.
3. **Save**: Upon completing the transaction, we write the HTTP response payload to Redis with a 24-hour TTL.
- **High Availability Fallback**: If Redis is unreachable, the system logs the error and gracefully falls back to memory mapping in development or direct database writes, ensuring high availability.

---

## 6. API Reference

All responses conform to a standardized JSON schema:
```json
{
  "success": true,
  "data": { ... }
}
```
In case of errors, the response contains structured error objects:
```json
{
  "success": false,
  "error": {
    "code": "OUT_OF_STOCK",
    "message": "Insufficient stock available."
  }
}
```

### Endpoints
- `GET /api/products`: Returns all products with stock counts and warehouse lists.
- `GET /api/warehouses`: Returns all warehouses.
- `POST /api/reservations`: Reserves stock. Body: `{ productId: string, warehouseId: string, quantity: number }`.
- `POST /api/reservations/:id/confirm`: Confirms a reservation.
- `POST /api/reservations/:id/release`: Cancels a hold.
- `GET/POST /api/cron/cleanup`: Sweeps expired reservations.

---

## 7. Concurrency Verification Script

We include a concurrency verification script in `src/scratch/verify-concurrency.ts`.
It tests transaction locks under high contention by firing 10 concurrent requests at 1 available inventory slot.

### Verification Steps
1. Seeds/Resets inventory of SKU `ALLO-VIT-005` in `WH-EAST` to `totalQuantity = 1`, `reservedQuantity = 0`.
2. Fires 10 concurrent reservation requests simultaneously using `Promise.all`.
3. Asserts that **exactly 1** succeeds (returning `201 Created`) and **exactly 9** fail with `OUT_OF_STOCK` (returning `409 Conflict`).
4. Asserts that the final database state shows exactly `reservedQuantity = 1`.

---

## 8. Scalability & Operational Considerations

- **Audit Ledger**: In a real production system, direct column increments are audited. An `InventoryLedger` table should record every increment and decrement referencing the `ReservationId`.
- **Database Partitioning**: The `Inventory` table can be horizontally partitioned by `warehouseId` (hash partitioning) to distribute row-locking overhead across physical storage segments.
- **Message Queues**: For extreme product drops, direct locking can bottleneck. Placing reservation intents on a fast message queue (e.g. Redis Streams or SQS) lets workers serialize database writes smoothly without pooling issues.
- **Monitoring**:
  - Alert on database lock wait times $> 2$ seconds.
  - Alert on abnormal spikes in 409 status codes (bot activity indicator).
  - Monitor cron job execution status to prevent stock leaks.

---

## 9. Developer Setup & Verification

### 9.1 Environment Variables
Create a `.env` file in the root:
```env
DATABASE_URL="postgresql://username:password@hostname:port/database?sslmode=require"
UPSTASH_REDIS_REST_URL="https://your-redis-endpoint.upstash.io"
UPSTASH_REDIS_REST_TOKEN="your-upstash-token"
CRON_SECRET="your-vercel-cron-secret-key"
```

### 9.2 Commands
1. **Install Dependencies**:
   ```bash
   npm install
   ```
2. **Apply Migrations**:
   ```bash
   npx prisma db push
   ```
   *Note: Our seed script automatically verifies and applies PostgreSQL CHECK constraints (`chk_reserved_qty_positive`, `chk_total_qty_positive`, `chk_reserved_qty_within_limit`) dynamically using raw SQL, ensuring they are active on your hosted DB.*
3. **Seed Database**:
   ```bash
   npx prisma db seed
   ```
4. **Run Concurrency Tests**:
   ```bash
   npx tsx src/scratch/verify-concurrency.ts
   ```
5. **Run Local Server**:
   ```bash
   npm run dev
   ```
