import { normalizePath } from "../utils/path-utils";

export class DependencyGraph {
  private readonly dependentToSources = new Map<string, Set<string>>();
  private readonly sourceToDependents = new Map<string, Set<string>>();

  addDependencies(dependent: string, sources: Iterable<string>): void {
    const normalizedDependent = normalizePath(dependent);
    const nextSources = new Set([...sources].map(normalizePath));

    this.clearDependent(normalizedDependent);
    if (nextSources.size === 0) {
      return;
    }

    this.dependentToSources.set(normalizedDependent, nextSources);
    for (const source of nextSources) {
      let dependents = this.sourceToDependents.get(source);
      if (!dependents) {
        dependents = new Set();
        this.sourceToDependents.set(source, dependents);
      }
      dependents.add(normalizedDependent);
    }
  }

  getDependents(source: string): Set<string> {
    return new Set(this.sourceToDependents.get(normalizePath(source)) ?? []);
  }

  clearDependent(dependent: string): void {
    const normalizedDependent = normalizePath(dependent);
    const sources = this.dependentToSources.get(normalizedDependent);
    if (!sources) {
      return;
    }

    for (const source of sources) {
      const dependents = this.sourceToDependents.get(source);
      if (!dependents) {
        continue;
      }

      dependents.delete(normalizedDependent);
      if (dependents.size === 0) {
        this.sourceToDependents.delete(source);
      }
    }

    this.dependentToSources.delete(normalizedDependent);
  }

  clear(): void {
    this.dependentToSources.clear();
    this.sourceToDependents.clear();
  }
}
