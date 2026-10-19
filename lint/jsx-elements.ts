import { parseSync } from "oxc-parser";

/** A JSX element as these checks read it: its tag, attributes, and enclosing elements. */
export interface JsxElement {
  tag: string;
  attributes: Map<string, unknown>;
  /** The static class tokens of `className`: every string literal in it, split on spaces. */
  classes: string[];
  /** Enclosing JSX elements, innermost first. */
  ancestors: JsxElement[];
}

const isNode = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Every string literal in an expression, so `cn("a", open && "b")` reads as `a b`. */
export const stringLiterals = (node: unknown): string[] => {
  if (Array.isArray(node)) {
    return node.flatMap(stringLiterals);
  }
  if (!isNode(node)) {
    return [];
  }
  if (node.type === "Literal" && typeof node.value === "string") {
    return [node.value];
  }
  if (node.type === "TemplateElement" && isNode(node.value)) {
    return [String(node.value.cooked ?? "")];
  }
  return Object.values(node).flatMap(stringLiterals);
};

const tagName = (name: unknown): string => {
  if (!isNode(name)) {
    return "";
  }
  if (name.type === "JSXMemberExpression") {
    return `${tagName(name.object)}.${tagName(name.property)}`;
  }
  return String(name.name ?? "");
};

/** Every JSX element in a TSX source, with the elements around it. */
export const parseJsxElements = (
  path: string,
  source: string
): JsxElement[] => {
  const { program, errors } = parseSync(path, source);
  if (errors.length > 0) {
    throw new Error(`${path} does not parse: ${errors[0].message}`);
  }
  const found: JsxElement[] = [];
  const visit = (node: unknown, ancestors: JsxElement[]) => {
    if (Array.isArray(node)) {
      for (const child of node) {
        visit(child, ancestors);
      }
      return;
    }
    if (!isNode(node)) {
      return;
    }
    if (node.type !== "JSXElement" || !isNode(node.openingElement)) {
      for (const child of Object.values(node)) {
        visit(child, ancestors);
      }
      return;
    }
    const opening = node.openingElement;
    const attributes = new Map<string, unknown>();
    for (const attribute of Array.isArray(opening.attributes)
      ? opening.attributes
      : []) {
      if (isNode(attribute) && attribute.type === "JSXAttribute") {
        attributes.set(tagName(attribute.name), attribute.value);
      }
    }
    const element: JsxElement = {
      tag: tagName(opening.name),
      attributes,
      classes: stringLiterals(attributes.get("className")).flatMap((value) =>
        value.split(/\s+/u).filter(Boolean)
      ),
      ancestors,
    };
    found.push(element);
    visit(opening.attributes, [element, ...ancestors]);
    visit(node.children, [element, ...ancestors]);
  };
  visit(program, []);
  return found;
};
