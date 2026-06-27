declare module "pg" {
  export class Client {
    constructor(config: { connectionString: string; ssl?: { rejectUnauthorized?: boolean } });
    connect(): Promise<void>;
    query<T = Record<string, unknown>>(sql: string): Promise<{ rows: T[] }>;
    end(): Promise<void>;
  }

  const pg: { Client: typeof Client };
  export default pg;
}
