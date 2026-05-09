import { normalizePath } from "../utils/path-utils";

export class ConsumerGraph {
  private consumerToTypes = new Map<string, Set<string>>();
  private typeToConsumers = new Map<string, Set<string>>();
  private consumerToFiles = new Map<string, Set<string>>();
  private fileToConsumers = new Map<string, Set<string>>();

  getConsumerModules(): string[] {
    return [...new Set([...this.consumerToTypes.keys(), ...this.consumerToFiles.keys()])];
  }

  registerTypeConsumer(consumerModule: string, typeKey: string): void {
    const consumer = normalizePath(consumerModule);
    addMapSetValue({ map: this.consumerToTypes, key: consumer, value: typeKey });
    addMapSetValue({ map: this.typeToConsumers, key: typeKey, value: consumer });
  }

  registerFileConsumer(consumerModule: string, sourceFile: string): void {
    const consumer = normalizePath(consumerModule);
    const source = normalizePath(sourceFile);

    addMapSetValue({ map: this.consumerToFiles, key: consumer, value: source });
    addMapSetValue({ map: this.fileToConsumers, key: source, value: consumer });
  }

  getTypeConsumers(typeKey: string): Set<string> {
    return new Set(this.typeToConsumers.get(typeKey) ?? []);
  }

  hasTypeConsumers(typeKey: string): boolean {
    return this.typeToConsumers.has(typeKey);
  }

  getFileConsumers(sourceFile: string): Set<string> {
    return new Set(this.fileToConsumers.get(normalizePath(sourceFile)) ?? []);
  }

  clearConsumer(consumerModule: string): void {
    const consumer = normalizePath(consumerModule);

    removeConsumerLinks({
      consumer,
      consumerToSources: this.consumerToTypes,
      sourceToConsumers: this.typeToConsumers,
    });

    removeConsumerLinks({
      consumer,
      consumerToSources: this.consumerToFiles,
      sourceToConsumers: this.fileToConsumers,
    });
  }

  clear(): void {
    this.consumerToTypes.clear();
    this.typeToConsumers.clear();
    this.consumerToFiles.clear();
    this.fileToConsumers.clear();
  }
}

type AddMapSetValueOptions = {
  map: Map<string, Set<string>>;
  key: string;
  value: string;
};

const addMapSetValue = (options: AddMapSetValueOptions): void => {
  const { map, key, value } = options;
  let values = map.get(key);
  if (!values) {
    values = new Set();
    map.set(key, values);
  }
  values.add(value);
};

type RemoveConsumerLinksOptions = {
  consumer: string;
  consumerToSources: Map<string, Set<string>>;
  sourceToConsumers: Map<string, Set<string>>;
};

const removeConsumerLinks = (options: RemoveConsumerLinksOptions): void => {
  const { consumer, consumerToSources, sourceToConsumers } = options;
  const sources = consumerToSources.get(consumer);

  if (!sources) {
    return;
  }

  for (const source of sources) {
    const consumers = sourceToConsumers.get(source);

    if (!consumers) {
      continue;
    }

    consumers.delete(consumer);

    if (consumers.size === 0) {
      sourceToConsumers.delete(source);
    }
  }

  consumerToSources.delete(consumer);
};
