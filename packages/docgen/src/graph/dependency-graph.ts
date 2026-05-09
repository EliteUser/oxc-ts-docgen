import { normalizePath } from "../utils/path-utils";

/**
 * Tracks source-to-dependent relationships with normalized path-like keys. The graph is
 * intentionally adapter-agnostic: Vite, future bundler adapters, and core cache code can all map
 * their own cache ids or module ids onto it.
 */
export class DependencyGraph {
  private sourceToDependents = new Map<string, Set<string>>();
  private dependentToSources = new Map<string, Set<string>>();

  addDependency(source: string, dependent: string): void {
    const src = normalizePath(source);
    const dep = normalizePath(dependent);
    let dependents = this.sourceToDependents.get(src);

    if (!dependents) {
      dependents = new Set();
      this.sourceToDependents.set(src, dependents);
    }

    dependents.add(dep);

    let sources = this.dependentToSources.get(dep);
    if (!sources) {
      sources = new Set();
      this.dependentToSources.set(dep, sources);
    }

    sources.add(src);
  }

  addDependencies(dependent: string, sources: Iterable<string>): void {
    for (const source of sources) {
      this.addDependency(source, dependent);
    }
  }

  getDependents(source: string): Set<string> {
    return new Set(this.sourceToDependents.get(normalizePath(source)) ?? []);
  }

  collectAffected(sources: Iterable<string>): string[] {
    const affected = new Set<string>();
    const queue = [...sources].map(normalizePath);

    for (let index = 0; index < queue.length; index++) {
      const current = queue[index];
      if (affected.has(current)) {
        continue;
      }

      affected.add(current);

      const dependents = this.sourceToDependents.get(current);
      if (!dependents) {
        continue;
      }

      for (const dependent of dependents) {
        if (!affected.has(dependent)) {
          queue.push(dependent);
        }
      }
    }

    return [...affected];
  }

  clearDependent(dependent: string): void {
    const dep = normalizePath(dependent);
    const sources = this.dependentToSources.get(dep);
    if (!sources) {
      return;
    }

    for (const source of sources) {
      const dependents = this.sourceToDependents.get(source);
      if (!dependents) {
        continue;
      }

      dependents.delete(dep);
      if (dependents.size === 0) {
        this.sourceToDependents.delete(source);
      }
    }

    this.dependentToSources.delete(dep);
  }

  clear(): void {
    this.sourceToDependents.clear();
    this.dependentToSources.clear();
  }

  isTrackedSource(source: string): boolean {
    return this.sourceToDependents.has(normalizePath(source));
  }

  addConsumerDependency(sourceFile: string, consumerModule: string): void {
    this.addDependency(sourceFile, consumerModule);
  }

  getConsumers(sourceFile: string): Set<string> {
    return this.getDependents(sourceFile);
  }

  clearConsumer(consumerModule: string): void {
    this.clearDependent(consumerModule);
  }
}
