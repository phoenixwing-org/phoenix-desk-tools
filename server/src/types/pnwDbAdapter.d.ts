declare module "phoenix-wing/db/pnwDbAdapter" {
  export interface PnwDbAdapter {
    get<T = Record<string, unknown>>(sql: string, params?: unknown): T | undefined;
    all<T = Record<string, unknown>>(sql: string, params?: unknown): T[];
    run(sql: string, params?: unknown): { changes: number };
    exec(sql: string): void;
    readonly inTransaction: boolean;
    close(): void;
  }

  export function pnwCreateDb(dbPath: string): PnwDbAdapter;
}
