function norm(p: string): string {
  return p.split("\\").join("/");
}

/**
 * Dependency graph tracking which source files are used by which consumer modules.
 * When a source file changes, all consumer modules that called getDocs<T>() with
 * a type from that file need to be re-transformed.
 *
 * All paths are normalized to forward slashes so Vite paths (forward slash)
 * and Node path.resolve paths (backslash on Windows) always match.
 */
export class DependencyGraph {
  private sourceToConsumers = new Map<string, Set<string>>();
  private consumerToSources = new Map<string, Set<string>>();

  addDependency(sourceFile: string, consumerModule: string): void {
    const src = norm(sourceFile);
    const consumer = norm(consumerModule);

    let consumers = this.sourceToConsumers.get(src);
    if (!consumers) {
      consumers = new Set();
      this.sourceToConsumers.set(src, consumers);
    }
    consumers.add(consumer);

    let sources = this.consumerToSources.get(consumer);
    if (!sources) {
      sources = new Set();
      this.consumerToSources.set(consumer, sources);
    }
    sources.add(src);
  }

  getConsumers(sourceFile: string): Set<string> {
    return this.sourceToConsumers.get(norm(sourceFile)) ?? new Set();
  }

  clearConsumer(consumerModule: string): void {
    const consumer = norm(consumerModule);
    const sources = this.consumerToSources.get(consumer);
    if (!sources) return;

    for (const source of sources) {
      const consumers = this.sourceToConsumers.get(source);
      if (consumers) {
        consumers.delete(consumer);
        if (consumers.size === 0) {
          this.sourceToConsumers.delete(source);
        }
      }
    }
    this.consumerToSources.delete(consumer);
  }

  isTrackedSource(filePath: string): boolean {
    return this.sourceToConsumers.has(norm(filePath));
  }
}
