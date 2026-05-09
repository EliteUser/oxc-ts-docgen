type IsIgnoredTypeNameOptions = {
  /**
   * Effective docgen config containing preset and user endpoint names.
   */
  config: {
    /**
     * Type names that should remain references instead of being expanded.
     */
    ignoreTypes: readonly string[];
  };
  /**
   * Type name as authored or resolved from syntax.
   */
  name: string;
};

/**
 * Endpoint names may be configured as either qualified names or short names.
 */
export const isIgnoredTypeName = (options: IsIgnoredTypeNameOptions): boolean => {
  const { config, name } = options;
  const shortName = name.split(".").at(-1) ?? name;

  return config.ignoreTypes.includes(name) || config.ignoreTypes.includes(shortName);
};
