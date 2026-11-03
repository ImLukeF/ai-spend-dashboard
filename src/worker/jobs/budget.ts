export class BudgetExceeded extends Error {
  constructor() {
    super("Tick resource budget exhausted");
  }
}
export class BudgetCounter {
  requests = 0;
  queries = 0;
  readonly max: number;
  constructor(
    plan: "free" | "paid",
    readonly deadline = Date.now() + 45000,
  ) {
    this.max = plan === "free" ? 40 : 500;
  }
  request() {
    if (this.requests >= this.max || Date.now() > this.deadline) throw new BudgetExceeded();
    this.requests++;
  }
  query() {
    if (this.queries >= this.max) throw new BudgetExceeded();
    this.queries++;
  }
  fits(requests: number, queries: number) {
    return (
      this.requests + requests <= this.max &&
      this.queries + queries <= this.max &&
      Date.now() < this.deadline
    );
  }
}
export function countedDb(db: D1Database, budget: BudgetCounter): D1Database {
  return new Proxy(db, {
    get(target, key) {
      if (key === "batch")
        return (statements: D1PreparedStatement[]) => {
          budget.query();
          return target.batch(statements);
        };
      if (key === "exec")
        return (sql: string) => {
          budget.query();
          return target.exec(sql);
        };
      if (key === "prepare") return (sql: string) => wrap(target.prepare(sql));
      const v = Reflect.get(target, key);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  function wrap(stmt: D1PreparedStatement): D1PreparedStatement {
    return new Proxy(stmt, {
      get(target, key) {
        if (key === "bind") return (...args: unknown[]) => wrap(target.bind(...args));
        if (["all", "run", "first", "raw"].includes(String(key)))
          return (...args: unknown[]) => {
            budget.query();
            return Reflect.apply(Reflect.get(target, key), target, args);
          };
        const v = Reflect.get(target, key);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
  }
}
