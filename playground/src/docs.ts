import type { DocSchema } from "@synthfall/oxc-ts-docgen";

import { getDocs } from "@synthfall/oxc-ts-docgen";

import type {
  ComponentComposedProps,
  ComponentContractProps,
  ComponentDomainProps,
  ComponentFlatProps,
  ComponentInputProps,
  ComponentPolymorphicProps,
  ComponentTextAreaProps,
  ComponentUnionProps,
} from "./examples";

export type PlaygroundExample = {
  /**
   * Stable key used by the playground sidebar.
   */
  id: string;

  /**
   * Requested TypeScript type.
   */
  typeName: string;

  /**
   * Generated docgen schema for the requested type.
   */
  docs: DocSchema;
};

const componentFlatPropsDocs = getDocs<ComponentFlatProps>();
const componentPolymorphicPropsDocs = getDocs<ComponentPolymorphicProps>();
const componentInputPropsDocs = getDocs<ComponentInputProps>();
const componentTextAreaPropsDocs = getDocs<ComponentTextAreaProps>();
const componentUnionPropsDocs = getDocs<ComponentUnionProps>();
const componentDomainPropsDocs = getDocs<ComponentDomainProps>();
const componentComposedPropsDocs = getDocs<ComponentComposedProps>();
const componentContractPropsDocs = getDocs<ComponentContractProps>();

export const componentCaseExamples: PlaygroundExample[] = [
  {
    id: "component-flat-props",
    typeName: "FlatProps",
    docs: componentFlatPropsDocs,
  },
  {
    id: "component-polymorphic-props",
    typeName: "PolymorphicProps",
    docs: componentPolymorphicPropsDocs,
  },
  {
    id: "component-input-props",
    typeName: "InputProps",
    docs: componentInputPropsDocs,
  },
  {
    id: "component-text-area-props",
    typeName: "TextAreaProps",
    docs: componentTextAreaPropsDocs,
  },
  {
    id: "component-union-props",
    typeName: "UnionProps",
    docs: componentUnionPropsDocs,
  },
  {
    id: "component-domain-props",
    typeName: "DomainProps",
    docs: componentDomainPropsDocs,
  },
  {
    id: "component-composed-props",
    typeName: "ComposedProps",
    docs: componentComposedPropsDocs,
  },
  {
    id: "component-contract-props",
    typeName: "ContractProps",
    docs: componentContractPropsDocs,
  },
];
