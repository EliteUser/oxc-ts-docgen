/**
 * Mapped type example.
 */
export type ReadonlyRecord<K extends string, V> = {
  readonly [P in K]: V;
};

/**
 * Conditional type example.
 */
export type IsString<T> = T extends string ? true : false;

/**
 * Indexed access.
 */
export interface Config {
  /**
   * Database settings.
   */
  database: {
    host: string;
    port: number;
  };
  /**
   * Cache settings.
   */
  cache: {
    ttl: number;
    enabled: boolean;
  };
}

export type DatabaseConfig = Config["database"];

/**
 * Tuple type.
 */
export type Point2D = [x: number, y: number];

/**
 * Tuple with rest.
 */
export type StringAndNumbers = [string, ...number[]];

/**
 * Template literal type.
 */
export type EventName = `on${string}`;

/**
 * Keyof usage.
 */
export type ConfigKeys = keyof Config;

/**
 * Function type alias.
 */
export type Formatter = (value: string, options?: { locale: string }) => string;

/**
 * Intersection type.
 */
export type WithTimestamp = {
  createdAt: Date;
  updatedAt: Date;
} & {
  deletedAt?: Date;
};
