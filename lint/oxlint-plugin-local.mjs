/**
 * Project-local oxlint JS plugin.
 *
 * Rules enforce UI composition patterns that @shadcn/lint does not cover.
 */

const ABSOLUTE_CLASS = /(^|\s)absolute(\s|$)/;
const RELATIVE_CLASS = /(^|\s)relative(\s|$)/;
const POPOVER_CONTENT_PADDING_CLASS =
  /(^|\s)(p-[234]|px-[234]|py-[234]|pt-[234]|pr-[234]|pb-[234]|pl-[234]|gap-[34])(\s|$)/;
const OVERLAY_SECTION_BORDER_CLASS = /(^|\s)border-b(\s|$)/;
const OVERLAY_SECTION_PADDING_CLASS = /(^|\s)px-[345](\s|$)/;
const LIST_ROW_BORDER_CLASS = /last:border-b-0/;
const TRANSITION_COLORS_CLASS = /transition-colors|transition-plan-item/;
const ANIMATE_SPIN_CLASS = /(?:^|[\s:!])animate-spin(?=$|[\s!])/;
// `backdrop-blur`, `backdrop-blur-*`, and the `supports-backdrop-filter:`
// variant, alone or behind other variants (`md:`, `data-open:`, `group-*:`).
const BACKDROP_BLUR_CLASS =
  /(?:^|[\s:!])(?:backdrop-blur(?:$|[\s!-])|supports-backdrop-filter:)/;
const OVERLAY_SECTION_BORDER_IGNORED_FILES = [
  "components/ui/",
  "components/schedule/plan-tab-toolbar.tsx",
  "components/schedule/schedule-page-fallbacks.tsx",
  "components/people/health-roster.tsx",
  "components/service-plan-table-selector.tsx",
  "components/schedule/plan-item-list.tsx",
  "components/app-shell.tsx",
  "components/people/month-view.tsx",
];
const BARE_INPUT_NAMES = new Set(["Input", "Textarea", "input", "textarea"]);
const SHARED_UI_DIRECTORY = "/components/ui/";
/** Native controls and the shared primitive that owns their look. */
const SHARED_CONTROL_REPLACEMENTS = new Map([
  [
    "button",
    '`<Button>` (or `<Item render={<button type="button" />}>` for clickable rows)',
  ],
  ["input", "`<Input>` or `<InputGroupInput>`"],
  ["select", "`<NativeSelect>` or `<Select>`"],
  ["textarea", "`<Textarea>` or `<InputGroupTextarea>`"],
]);

/**
 * @param {unknown} node
 * @returns {string | null}
 */
const getJsxName = (node) => {
  if (!node || typeof node !== "object") {
    return null;
  }
  if (node.type === "JSXIdentifier" && typeof node.name === "string") {
    return node.name;
  }
  if (node.type === "JSXMemberExpression") {
    return getJsxName(node.property);
  }
  return null;
};

/**
 * @param {unknown} value
 * @param {(name: string) => string} [resolveIdentifier] class text of a named constant
 * @returns {string}
 */
const classNameText = (value, resolveIdentifier) => {
  if (!value || typeof value !== "object") {
    return "";
  }
  if (value.type === "Literal" && typeof value.value === "string") {
    return value.value;
  }
  if (value.type === "Identifier") {
    return resolveIdentifier?.(value.name) ?? "";
  }
  if (value.type === "JSXExpressionContainer") {
    return classNameText(value.expression, resolveIdentifier);
  }
  if (value.type === "TemplateLiteral") {
    return value.quasis.map((quasi) => quasi.value.cooked ?? "").join(" ");
  }
  if (value.type === "BinaryExpression" && value.operator === "+") {
    return `${classNameText(value.left, resolveIdentifier)} ${classNameText(value.right, resolveIdentifier)}`;
  }
  if (value.type === "CallExpression") {
    return value.arguments
      .map((argument) => classNameText(argument, resolveIdentifier))
      .join(" ");
  }
  if (value.type === "ConditionalExpression") {
    return `${classNameText(value.consequent, resolveIdentifier)} ${classNameText(value.alternate, resolveIdentifier)}`;
  }
  if (value.type === "LogicalExpression") {
    return `${classNameText(value.left, resolveIdentifier)} ${classNameText(value.right, resolveIdentifier)}`;
  }
  if (value.type === "ArrayExpression") {
    return value.elements
      .map((element) => classNameText(element, resolveIdentifier))
      .join(" ");
  }
  if (value.type === "ObjectExpression") {
    return value.properties
      .map((property) => {
        if (property.type !== "Property" || property.computed) {
          return "";
        }
        if (property.key.type === "Identifier") {
          return property.key.name;
        }
        if (
          property.key.type === "Literal" &&
          typeof property.key.value === "string"
        ) {
          return property.key.value;
        }
        return "";
      })
      .join(" ");
  }
  return "";
};

/**
 * @param {import("oxlint/plugins-dev").JSXOpeningElement} openingElement
 * @param {RegExp} pattern
 */
const openingHasClass = (openingElement, pattern) => {
  for (const attribute of openingElement.attributes) {
    if (
      attribute.type !== "JSXAttribute" ||
      attribute.name.type !== "JSXIdentifier" ||
      attribute.name.name !== "className" ||
      attribute.value === null
    ) {
      continue;
    }
    if (pattern.test(classNameText(attribute.value))) {
      return true;
    }
  }
  return false;
};

/**
 * Collect JSX elements from a child slot, including conditional/logical wrappers.
 * @param {unknown} node
 * @param {import("oxlint/plugins-dev").JSXElement[]} out
 */
const collectJsxElements = (node, out) => {
  if (!node || typeof node !== "object") {
    return;
  }
  if (node.type === "JSXElement") {
    out.push(node);
    return;
  }
  if (node.type === "JSXFragment") {
    for (const child of node.children) {
      collectJsxElements(child, out);
    }
    return;
  }
  if (node.type === "JSXExpressionContainer") {
    collectJsxElements(node.expression, out);
    return;
  }
  if (node.type === "ConditionalExpression") {
    collectJsxElements(node.consequent, out);
    collectJsxElements(node.alternate, out);
    return;
  }
  if (node.type === "LogicalExpression") {
    collectJsxElements(node.right, out);
  }
};

/**
 * @param {import("oxlint/plugins-dev").JSXOpeningElement} openingElement
 * @param {string} name
 */
const hasAttribute = (openingElement, name) =>
  openingElement.attributes.some(
    (attribute) =>
      attribute.type === "JSXAttribute" &&
      attribute.name.type === "JSXIdentifier" &&
      attribute.name.name === name
  );

/**
 * True when the element is the value of a `render` prop, e.g.
 * `<Item render={<button type="button" />}>`.
 * @param {import("oxlint/plugins-dev").JSXOpeningElement} openingElement
 */
const isRenderPropTarget = (openingElement) => {
  const element = openingElement.parent;
  const container = element?.parent;
  const attribute = container?.parent;
  return (
    container?.type === "JSXExpressionContainer" &&
    attribute?.type === "JSXAttribute" &&
    attribute.name.type === "JSXIdentifier" &&
    attribute.name.name === "render"
  );
};

const preferSharedControlsRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow hand-styled native buttons, inputs, selects, and textareas outside components/ui. Shared primitives own how controls look and feel.",
    },
    messages: {
      raw: "Use {{replacement}} instead of a hand-rolled `<{{tag}}>`. Controls get their look from primitives in components/ui; when you need the native element, pass a bare `<{{tag}} />` (no className or style) through a primitive's `render` prop.",
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename.replaceAll("\\", "/");
    if (filename.includes(SHARED_UI_DIRECTORY)) {
      return {};
    }

    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier") {
          return;
        }
        const tag = node.name.name;
        const replacement = SHARED_CONTROL_REPLACEMENTS.get(tag);
        if (replacement === undefined) {
          return;
        }
        const isUnstyled =
          !hasAttribute(node, "className") && !hasAttribute(node, "style");
        if (isUnstyled && isRenderPropTarget(node)) {
          return;
        }
        context.report({
          node,
          messageId: "raw",
          data: { tag, replacement },
        });
      },
    };
  },
};

const noAbsoluteInputOverlayRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow absolute-positioned siblings overlaid on bare Input/Textarea. Use InputGroup + InputGroupAddon instead so icons cannot cover text.",
    },
    messages: {
      overlay:
        "Do not overlay absolute-positioned siblings on bare `<{{name}} />`. Use `InputGroup`, `InputGroupInput`/`InputGroupTextarea`, and `InputGroupAddon` so leading/trailing icons get layout space.",
    },
    schema: [],
  },
  create(context) {
    return {
      JSXElement(node) {
        if (!openingHasClass(node.openingElement, RELATIVE_CLASS)) {
          return;
        }

        const openingName = getJsxName(node.openingElement.name);
        if (openingName === "InputGroup") {
          return;
        }

        /** @type {import("oxlint/plugins-dev").JSXElement | null} */
        let bareControl = null;
        let hasAbsoluteSibling = false;

        /** @type {import("oxlint/plugins-dev").JSXElement[]} */
        const childElements = [];
        for (const child of node.children) {
          collectJsxElements(child, childElements);
        }

        for (const child of childElements) {
          const childName = getJsxName(child.openingElement.name);
          if (childName !== null && BARE_INPUT_NAMES.has(childName)) {
            bareControl = child;
          }
          if (openingHasClass(child.openingElement, ABSOLUTE_CLASS)) {
            hasAbsoluteSibling = true;
          }
        }

        if (!hasAbsoluteSibling || bareControl === null) {
          return;
        }

        const controlName =
          getJsxName(bareControl.openingElement.name) ?? "Input";
        context.report({
          node: bareControl,
          messageId: "overlay",
          data: { name: controlName },
        });
      },
    };
  },
};

const noPopoverContentPaddingRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow padding and large gap utilities on PopoverContent call sites. The popover shell stays flush; inner sections own spacing.",
    },
    messages: {
      padding:
        "Do not add padding or large gap utilities to `<PopoverContent />`. Keep the shell at `p-0` and put spacing on inner sections, headers, or Command/Calendar content.",
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename.replaceAll("\\", "/");
    if (filename.endsWith("components/ui/popover.tsx")) {
      return {};
    }

    return {
      JSXOpeningElement(node) {
        const name = getJsxName(node.name);
        if (name !== "PopoverContent") {
          return;
        }
        if (!openingHasClass(node, POPOVER_CONTENT_PADDING_CLASS)) {
          return;
        }
        context.report({
          node,
          messageId: "padding",
        });
      },
    };
  },
};

const noOverlaySectionBorderRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow border-b section dividers in overlay/list panels. Use ItemSeparator, DropdownMenuSeparator inset, or SidebarSeparator instead.",
    },
    messages: {
      border:
        "Do not use `border-b` for section dividers in menus, popovers, or list panels. Use `ItemSeparator`, `<DropdownMenuSeparator inset />`, or `<SidebarSeparator />` after the section header/content.",
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename.replaceAll("\\", "/");
    if (
      OVERLAY_SECTION_BORDER_IGNORED_FILES.some((ignoredPath) =>
        filename.includes(ignoredPath)
      )
    ) {
      return {};
    }

    return {
      JSXOpeningElement(node) {
        const tagName =
          node.name.type === "JSXIdentifier" ? node.name.name : null;
        if (
          tagName !== "div" &&
          tagName !== "header" &&
          tagName !== "section"
        ) {
          return;
        }
        if (!openingHasClass(node, OVERLAY_SECTION_BORDER_CLASS)) {
          return;
        }
        if (!openingHasClass(node, OVERLAY_SECTION_PADDING_CLASS)) {
          return;
        }
        if (openingHasClass(node, LIST_ROW_BORDER_CLASS)) {
          return;
        }
        context.report({
          node,
          messageId: "border",
        });
      },
    };
  },
};

const noTransitionColorsRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow transition-colors and transition-plan-item so hover and selection states snap instantly.",
    },
    messages: {
      transitionColors:
        "Do not use `transition-colors` or `transition-plan-item`. Keep hover, active, and selection color changes instant.",
    },
    schema: [],
  },
  create(context) {
    /**
     * @param {import("oxlint/plugins-dev").Node} node
     */
    const reportIfTransitionColors = (node) => {
      const text = classNameText(node);
      if (!TRANSITION_COLORS_CLASS.test(text)) {
        return;
      }
      context.report({
        node,
        messageId: "transitionColors",
      });
    };

    return {
      JSXOpeningElement(node) {
        for (const attribute of node.attributes) {
          if (
            attribute.type !== "JSXAttribute" ||
            attribute.name.type !== "JSXIdentifier" ||
            attribute.name.name !== "className" ||
            attribute.value === null
          ) {
            continue;
          }
          reportIfTransitionColors(attribute.value);
        }
      },
      CallExpression(node) {
        if (
          node.callee.type !== "Identifier" ||
          node.callee.name !== "cva" ||
          node.arguments.length === 0
        ) {
          return;
        }
        reportIfTransitionColors(node.arguments[0]);
      },
    };
  },
};

const noAnimateSpinRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow animate-spin so every loading indicator is the shared rocket Spinner.",
    },
    messages: {
      animateSpin:
        "Do not spin icons with `animate-spin`. Render `<Spinner />` from `@/components/ui/spinner`, the rocket loading indicator.",
    },
    schema: [],
  },
  create(context) {
    /**
     * @param {import("oxlint/plugins-dev").Node} node
     */
    const reportIfAnimateSpin = (node) => {
      if (!ANIMATE_SPIN_CLASS.test(classNameText(node))) {
        return;
      }
      context.report({
        node,
        messageId: "animateSpin",
      });
    };

    return {
      JSXOpeningElement(node) {
        for (const attribute of node.attributes) {
          if (
            attribute.type !== "JSXAttribute" ||
            attribute.name.type !== "JSXIdentifier" ||
            attribute.name.name !== "className" ||
            attribute.value === null
          ) {
            continue;
          }
          reportIfAnimateSpin(attribute.value);
        }
      },
      CallExpression(node) {
        if (
          node.callee.type !== "Identifier" ||
          node.callee.name !== "cva" ||
          node.arguments.length === 0
        ) {
          return;
        }
        reportIfAnimateSpin(node.arguments[0]);
      },
    };
  },
};

// Scroll and clip containers cut off anything painted outside a child's box.
const CLIP_CONTAINER_CLASS =
  /(?:^|[\s:!])overflow(?:-[xy])?-(?:auto|scroll|hidden|clip)(?=$|[\s!])/;
/** Primitives whose root paints a ring or shadow outside its box. */
const RAISED_SURFACE_NAMES = new Set(["Card"]);
const RAISED_SURFACE_TOKEN =
  /^(?:shadow(?:-(?:2xs|xs|sm|md|lg|xl|2xl))?|ring(?:-(?:[1-9]\d*|\[[^\]]+\]))?)$/;
/** Focus rings are a separate concern; this rule covers resting surfaces. */
const FOCUS_VARIANT =
  /(?:^|:)(?:group-|peer-)?focus(?:-visible|-within)?(?:\/\w+)?:/;
const INSET_RING_TOKEN = "ring-inset";
/** Elements that render outside the clip: portals and fixed-position drag overlays. */
const ESCAPES_CLIP_NAME =
  /(?:Portal|Overlay|^(?:AlertDialog|Combobox|ContextMenu|Dialog|Drawer|DropdownMenu|HoverCard|Popover|Select|Sheet)Content)$/;
const SPACING_TOKEN = /^(p|m)([xytblrse]?)-(.+)$/;
const ZERO_SPACING = /^(?:0|px|auto)$/;
const PASCAL_CASE = /^[A-Z]/;
const SIDE_KEYS = ["top", "right", "bottom", "left"];
/** Which sides each padding/margin axis letter covers (logical start/end as left/right). */
const SPACING_SIDES = new Map([
  ["", SIDE_KEYS],
  ["x", ["left", "right"]],
  ["y", ["top", "bottom"]],
  ["t", ["top"]],
  ["b", ["bottom"]],
  ["l", ["left"]],
  ["s", ["left"]],
  ["r", ["right"]],
  ["e", ["right"]],
]);

/**
 * @param {string} text
 * @returns {{ variant: string, base: string }[]}
 */
const classTokens = (text) =>
  text
    .split(/\s+/u)
    .filter(Boolean)
    .map((token) => {
      const separator = token.lastIndexOf(":");
      const variant = separator === -1 ? "" : token.slice(0, separator + 1);
      const base = token.slice(separator + 1).replaceAll("!", "");
      return { variant, base };
    });

/**
 * @param {import("oxlint/plugins-dev").JSXOpeningElement} openingElement
 * @param {(name: string) => string} [resolveIdentifier]
 * @returns {string}
 */
const openingClassText = (openingElement, resolveIdentifier) =>
  openingElement.attributes
    .map((attribute) =>
      attribute.type === "JSXAttribute" &&
      attribute.name.type === "JSXIdentifier" &&
      attribute.name.name === "className" &&
      attribute.value !== null
        ? classNameText(attribute.value, resolveIdentifier)
        : ""
    )
    .join(" ");

/**
 * Class strings held in top-level constants, so `className={panelClassName}` reads like
 * the literal it names.
 * @param {import("oxlint/plugins-dev").Program} program
 * @returns {(name: string) => string}
 */
const classConstantResolver = (program) => {
  /** @type {Map<string, unknown>} */
  const initializers = new Map();
  for (const topLevel of program.body) {
    const statement =
      topLevel.type === "ExportNamedDeclaration"
        ? topLevel.declaration
        : topLevel;
    if (
      statement?.type !== "VariableDeclaration" ||
      statement.kind !== "const"
    ) {
      continue;
    }
    for (const declarator of statement.declarations) {
      if (declarator.id.type === "Identifier" && declarator.init) {
        initializers.set(declarator.id.name, declarator.init);
      }
    }
  }
  /** @type {Set<string>} */
  const resolving = new Set();
  /** @param {string} name */
  const resolve = (name) => {
    if (resolving.has(name)) {
      return "";
    }
    resolving.add(name);
    const text = classNameText(initializers.get(name), resolve);
    resolving.delete(name);
    return text;
  };
  return resolve;
};

/**
 * Sides that get room from padding or positive margin, at any breakpoint.
 * @param {string} text
 * @returns {Set<string>}
 */
const spacedSides = (text) => {
  const sides = new Set();
  for (const { base } of classTokens(text)) {
    const match = SPACING_TOKEN.exec(base);
    if (!match || ZERO_SPACING.test(match[3])) {
      continue;
    }
    for (const side of SPACING_SIDES.get(match[2]) ?? []) {
      sides.add(side);
    }
  }
  return sides;
};

/**
 * @param {import("oxlint/plugins-dev").JSXOpeningElement} openingElement
 * @param {(name: string) => string} [resolveIdentifier]
 */
const isRaisedSurface = (openingElement, resolveIdentifier) => {
  const name = getJsxName(openingElement.name);
  if (name !== null && RAISED_SURFACE_NAMES.has(name)) {
    return true;
  }
  const tokens = classTokens(
    openingClassText(openingElement, resolveIdentifier)
  );
  const ringsAreInset = tokens.some(({ base }) => base === INSET_RING_TOKEN);
  return tokens.some(
    ({ variant, base }) =>
      RAISED_SURFACE_TOKEN.test(base) &&
      !FOCUS_VARIANT.test(variant) &&
      !(ringsAreInset && base.startsWith("ring"))
  );
};

/**
 * `PageScrollArea` (components/page-shell.tsx) scrolls through its own overflow and pads
 * its content by the page gutter on the left and right only.
 */
const PAGE_SCROLL_AREA_NAME = "PageScrollArea";
const PAGE_SCROLL_AREA_PADDED_SIDES = ["left", "right"];

/**
 * @param {import("oxlint/plugins-dev").JSXOpeningElement} openingElement
 * @param {(name: string) => string} [resolveIdentifier]
 */
const isClipContainer = (openingElement, resolveIdentifier) => {
  const name = getJsxName(openingElement.name);
  return (
    name === "ScrollArea" ||
    name === PAGE_SCROLL_AREA_NAME ||
    CLIP_CONTAINER_CLASS.test(
      openingClassText(openingElement, resolveIdentifier)
    )
  );
};

/**
 * JSX a render can produce from an expression: elements, branches, and the
 * callbacks of `.map()`-style calls.
 * @param {unknown} node
 * @param {import("oxlint/plugins-dev").JSXElement[]} out
 */
const collectRenderedJsx = (node, out) => {
  if (!node || typeof node !== "object") {
    return;
  }
  switch (node.type) {
    case "JSXElement": {
      out.push(node);
      return;
    }
    case "JSXFragment": {
      for (const child of node.children) {
        collectRenderedJsx(child, out);
      }
      return;
    }
    case "JSXExpressionContainer":
    case "ParenthesizedExpression": {
      collectRenderedJsx(node.expression, out);
      return;
    }
    case "ConditionalExpression": {
      collectRenderedJsx(node.consequent, out);
      collectRenderedJsx(node.alternate, out);
      return;
    }
    case "LogicalExpression": {
      collectRenderedJsx(node.left, out);
      collectRenderedJsx(node.right, out);
      return;
    }
    case "CallExpression": {
      for (const argument of node.arguments) {
        collectFunctionJsx(argument, out);
      }
      return;
    }
    default:
  }
};

/**
 * @param {unknown} statement
 * @param {import("oxlint/plugins-dev").JSXElement[]} out
 */
const collectReturnedJsx = (statement, out) => {
  if (!statement || typeof statement !== "object") {
    return;
  }
  switch (statement.type) {
    case "ReturnStatement": {
      collectRenderedJsx(statement.argument, out);
      return;
    }
    case "BlockStatement": {
      for (const child of statement.body) {
        collectReturnedJsx(child, out);
      }
      return;
    }
    case "IfStatement": {
      collectReturnedJsx(statement.consequent, out);
      collectReturnedJsx(statement.alternate, out);
      return;
    }
    default:
  }
};

/**
 * @param {unknown} node
 * @param {import("oxlint/plugins-dev").JSXElement[]} out
 */
const collectFunctionJsx = (node, out) => {
  if (
    !node ||
    typeof node !== "object" ||
    (node.type !== "ArrowFunctionExpression" &&
      node.type !== "FunctionExpression" &&
      node.type !== "FunctionDeclaration")
  ) {
    return;
  }
  if (node.body.type === "BlockStatement") {
    collectReturnedJsx(node.body, out);
  } else {
    collectRenderedJsx(node.body, out);
  }
};

/**
 * Components declared in this file, by name, with the JSX they render.
 * @param {import("oxlint/plugins-dev").Program} program
 * @returns {Map<string, import("oxlint/plugins-dev").JSXElement[]>}
 */
const localComponents = (program) => {
  const components = new Map();
  /** @param {string} name @param {unknown} fn */
  const add = (name, fn) => {
    if (!PASCAL_CASE.test(name)) {
      return;
    }
    const rendered = [];
    collectFunctionJsx(fn, rendered);
    if (rendered.length > 0) {
      components.set(name, rendered);
    }
  };
  for (const topLevel of program.body) {
    const statement =
      topLevel.type === "ExportNamedDeclaration" ||
      topLevel.type === "ExportDefaultDeclaration"
        ? topLevel.declaration
        : topLevel;
    if (statement?.type === "FunctionDeclaration" && statement.id) {
      add(statement.id.name, statement);
    }
    if (statement?.type === "VariableDeclaration") {
      for (const declarator of statement.declarations) {
        if (declarator.id.type === "Identifier") {
          add(declarator.id.name, declarator.init);
        }
      }
    }
  }
  return components;
};

/**
 * Sides a clip container pads for its content. ScrollArea clips at its viewport, inside
 * the root that takes className; PageScrollArea pads by the page gutter on the sides.
 * @param {string} containerName
 * @param {string} classText
 * @returns {Set<string>}
 */
const clipContainerPaddedSides = (containerName, classText) => {
  if (containerName === "ScrollArea") {
    return new Set();
  }
  if (containerName === PAGE_SCROLL_AREA_NAME) {
    return new Set(PAGE_SCROLL_AREA_PADDED_SIDES);
  }
  return spacedSides(classText);
};

const noClippedSurfaceRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow cards and other ringed or shadowed surfaces flush against a scroll or clip container, which cuts their ring and shadow off.",
    },
    messages: {
      clipped:
        "`<{{surface}}>` paints a ring or shadow, but it sits flush against the {{container}} scroll/clip edge ({{sides}}), so the edge gets cut off. Give the scroll content padding on those sides (bleed with `-mx-N` + `px-N` to keep alignment).",
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename.replaceAll("\\", "/");
    if (filename.includes(SHARED_UI_DIRECTORY)) {
      return {};
    }
    /** @type {Map<string, import("oxlint/plugins-dev").JSXElement[]>} */
    let components = new Map();
    /** @type {(name: string) => string} */
    let resolveClass = () => "";
    const reported = new Set();

    /**
     * @param {import("oxlint/plugins-dev").JSXElement} element
     * @param {Set<string>} sides sides already padded between the container and here
     * @param {import("oxlint/plugins-dev").JSXElement} reportNode
     * @param {string} containerName
     * @param {Set<string>} visiting component names on the current path
     */
    const visit = (element, sides, reportNode, containerName, visiting) => {
      const opening = element.openingElement;
      const name = getJsxName(opening.name);
      const here = new Set([
        ...sides,
        ...spacedSides(openingClassText(opening, resolveClass)),
      ]);

      if (isRaisedSurface(opening, resolveClass)) {
        const missing = SIDE_KEYS.filter((side) => !here.has(side));
        if (missing.length > 0 && !reported.has(reportNode)) {
          reported.add(reportNode);
          context.report({
            node: reportNode.openingElement,
            messageId: "clipped",
            data: {
              surface: getJsxName(reportNode.openingElement.name) ?? "element",
              container: containerName,
              sides: missing.join(", "),
            },
          });
        }
        return;
      }
      // A nested container is checked on its own; portals and overlays escape.
      if (
        isClipContainer(opening, resolveClass) ||
        (name !== null && ESCAPES_CLIP_NAME.test(name))
      ) {
        return;
      }
      if (name !== null && components.has(name) && !visiting.has(name)) {
        const nextVisiting = new Set([...visiting, name]);
        for (const rendered of components.get(name) ?? []) {
          visit(rendered, here, reportNode, containerName, nextVisiting);
        }
      }
      const children = [];
      for (const child of element.children) {
        collectRenderedJsx(child, children);
      }
      for (const child of children) {
        visit(child, here, child, containerName, visiting);
      }
    };

    return {
      Program(node) {
        components = localComponents(node);
        resolveClass = classConstantResolver(node);
      },
      JSXElement(node) {
        const opening = node.openingElement;
        if (!isClipContainer(opening, resolveClass)) {
          return;
        }
        const containerName = getJsxName(opening.name) ?? "element";
        const ownSides = clipContainerPaddedSides(
          containerName,
          openingClassText(opening, resolveClass)
        );
        const children = [];
        for (const child of node.children) {
          collectRenderedJsx(child, children);
        }
        for (const child of children) {
          visit(child, ownSides, child, `<${containerName}>`, new Set());
        }
      },
    };
  },
};

// Rounded corners on the base token or a breakpoint, not `rounded-none`.
const ROUNDED_TOKEN = /^rounded(?:-[a-z]{1,2})?(?:-(?!none$)[\w.[\]/-]+)?$/;
const ROUNDED_NONE_TOKEN = /^rounded(?:-[a-z]{1,2})?-none$/;
const DIVIDE_Y_TOKEN = /^divide-y(?:-\d+)?$/;
const PADDING_TOKEN = /^p[xytblrse]?-(.+)$/;
const STATE_VARIANT =
  /(?:^|:)(?:[\w-]+-)?(?:hover|focus|active|group|peer|data|aria|has|in|not|\*|\[)/;
/** Interactive `<Item>` rows paint `[button]:hover:bg-*` from the primitive. */
const ITEM_NAME = "Item";
const ITEM_LIST_NAME = "ItemList";
/** `<Item variant="plain">` leaves the hover to the row that contains it. */
const ITEM_PLAIN_VARIANT = "plain";

/**
 * Class tokens that apply at rest (base or breakpoint), not on hover/state.
 * @param {string} text
 */
const restingTokens = (text) =>
  classTokens(text)
    .filter(({ variant }) => !STATE_VARIANT.test(variant))
    .map(({ base }) => base);

/**
 * @param {import("oxlint/plugins-dev").JSXOpeningElement} openingElement
 */
const isFlushRoundedBox = (openingElement) => {
  const tokens = restingTokens(openingClassText(openingElement));
  const isRounded =
    tokens.some((token) => ROUNDED_TOKEN.test(token)) &&
    !tokens.some((token) => ROUNDED_NONE_TOKEN.test(token));
  const isPadded = tokens.some((token) => {
    const match = PADDING_TOKEN.exec(token);
    return match !== null && !ZERO_SPACING.test(match[1]);
  });
  return isRounded && !isPadded;
};

/**
 * @param {import("oxlint/plugins-dev").JSXOpeningElement} openingElement
 */
const paintsHoverBackground = (openingElement) => {
  if (getJsxName(openingElement.name) === ITEM_NAME) {
    return (
      hasAttribute(openingElement, "render") &&
      stringAttribute(openingElement, "variant") !== ITEM_PLAIN_VARIANT
    );
  }
  return classTokens(openingClassText(openingElement)).some(
    ({ variant, base }) => variant.includes("hover:") && base.startsWith("bg-")
  );
};

/**
 * @param {import("oxlint/plugins-dev").JSXOpeningElement} openingElement
 * @param {string} name
 * @returns {string | null}
 */
const stringAttribute = (openingElement, name) => {
  for (const attribute of openingElement.attributes) {
    if (
      attribute.type === "JSXAttribute" &&
      attribute.name.type === "JSXIdentifier" &&
      attribute.name.name === name &&
      attribute.value?.type === "Literal" &&
      typeof attribute.value.value === "string"
    ) {
      return attribute.value.value;
    }
  }
  return null;
};

/**
 * @param {import("oxlint/plugins-dev").JSXOpeningElement} openingElement
 */
const hasOwnRadius = (openingElement) =>
  restingTokens(openingClassText(openingElement)).some((token) =>
    ROUNDED_TOKEN.test(token)
  );

/**
 * @param {import("oxlint/plugins-dev").JSXOpeningElement} openingElement
 */
const hasSquareCorners = (openingElement) =>
  restingTokens(openingClassText(openingElement)).some((token) =>
    ROUNDED_NONE_TOKEN.test(token)
  );

const flushListRowsRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Keep hover backgrounds of flush list rows on the list's border: rounded row lists use ItemList, and rows inside a rounded clip do not add their own radius.",
    },
    messages: {
      useItemList:
        "Rounded lists of divided rows should be `<ItemList>`. It clips the rows to its corners and squares `<Item>` rows, so hover backgrounds follow the list's border instead of drawing their own rounded shape.",
      rowRadius:
        "`<{{row}}>` paints a hover background with its own radius flush inside a rounded container, so the hover shape does not match the container's border. Drop the row's `rounded-*` and let the container clip it (use `<ItemList>` for row lists).",
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename.replaceAll("\\", "/");
    if (filename.includes(SHARED_UI_DIRECTORY)) {
      return {};
    }
    /** @type {Map<string, import("oxlint/plugins-dev").JSXElement[]>} */
    let components = new Map();
    const reported = new Set();

    /**
     * @param {import("oxlint/plugins-dev").JSXElement} row
     * @param {import("oxlint/plugins-dev").JSXElement} reportNode
     * @param {boolean} squaresItems
     * @param {Set<string>} visiting
     */
    const checkRow = (row, reportNode, squaresItems, visiting) => {
      const opening = row.openingElement;
      const name = getJsxName(opening.name);
      if (name !== null && components.has(name) && !visiting.has(name)) {
        const nextVisiting = new Set([...visiting, name]);
        for (const rendered of components.get(name) ?? []) {
          checkRow(rendered, reportNode, squaresItems, nextVisiting);
        }
        return;
      }
      if (!paintsHoverBackground(opening)) {
        // Unpadded, unrounded wrappers such as `<li>` keep the row flush.
        if (isFlushRoundedBox(opening) || !isUnpaddedWrapper(opening)) {
          return;
        }
        for (const child of renderedChildren(row)) {
          checkRow(child, reportNode, squaresItems, visiting);
        }
        return;
      }
      // `<Item>` is rounded by default; only ItemList or `rounded-none` squares it.
      const rounded =
        hasOwnRadius(opening) ||
        (name === ITEM_NAME && !squaresItems && !hasSquareCorners(opening));
      if (!rounded || reported.has(reportNode)) {
        return;
      }
      reported.add(reportNode);
      context.report({
        node: reportNode.openingElement,
        messageId: "rowRadius",
        data: { row: getJsxName(reportNode.openingElement.name) ?? "element" },
      });
    };

    return {
      Program(node) {
        components = localComponents(node);
      },
      JSXElement(node) {
        const opening = node.openingElement;
        const name = getJsxName(opening.name);
        const isItemList = name === ITEM_LIST_NAME;
        if (!isItemList) {
          if (!isFlushRoundedBox(opening)) {
            return;
          }
          const tokens = restingTokens(openingClassText(opening));
          if (tokens.some((token) => DIVIDE_Y_TOKEN.test(token))) {
            context.report({ node: opening, messageId: "useItemList" });
            return;
          }
          if (!isClipContainer(opening)) {
            return;
          }
        }
        for (const child of renderedChildren(node)) {
          checkRow(child, child, isItemList, new Set());
        }
      },
    };
  },
};

/**
 * @param {import("oxlint/plugins-dev").JSXElement} element
 * @returns {import("oxlint/plugins-dev").JSXElement[]}
 */
const renderedChildren = (element) => {
  const children = [];
  for (const child of element.children) {
    collectRenderedJsx(child, children);
  }
  return children;
};

/**
 * @param {import("oxlint/plugins-dev").JSXOpeningElement} openingElement
 */
const isUnpaddedWrapper = (openingElement) => {
  const name = getJsxName(openingElement.name);
  if (name === null || PASCAL_CASE.test(name)) {
    return false;
  }
  return !restingTokens(openingClassText(openingElement)).some((token) => {
    const match = PADDING_TOKEN.exec(token);
    return match !== null && !ZERO_SPACING.test(match[1]);
  });
};

const noBackdropBlurRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow blurred, frosted backgrounds (`backdrop-blur*` and the `supports-backdrop-filter:` variant).",
    },
    messages: {
      backdropBlur:
        "Avoid blurred/frosted backgrounds; use a solid semantic background such as bg-background or bg-popover.",
    },
    schema: [],
  },
  create(context) {
    /**
     * Class strings reach Tailwind through className, cn(), cva variants,
     * arrays, and constants, so every string in the file is checked.
     * @param {import("oxlint/plugins-dev").Node} node
     * @param {string} text
     */
    const reportIfBackdropBlur = (node, text) => {
      if (!BACKDROP_BLUR_CLASS.test(text)) {
        return;
      }
      context.report({
        node,
        messageId: "backdropBlur",
      });
    };

    return {
      Literal(node) {
        if (typeof node.value === "string") {
          reportIfBackdropBlur(node, node.value);
        }
      },
      TemplateElement(node) {
        reportIfBackdropBlur(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};

/** A small fixed offset that pushes a leading mark down to sit beside a line of text. */
const NUDGE_TOKEN =
  /^-?(?:mt|top)-(?:px|0\.5|1|1\.5)$|^-?translate-y-(?:px|0\.5|1)$/;
const SIZE_TOKEN = /^size-/;

/**
 * Icons, dots, and badges beside text must not be nudged into place with a one-off margin
 * or translate: the offset only matches one font size and line height. Center them in a
 * box one line tall (`<span className="flex h-lh items-center">`) so they align with the
 * first line at any size.
 */
const noNudgedIconRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow nudging a fixed-size icon, dot, or badge with mt-*, top-*, or translate-y-* to line it up with text.",
    },
    messages: {
      nudgedIcon:
        'Do not nudge `{{name}}` with `{{token}}` to line it up with text. Wrap it in `<span className="flex h-lh shrink-0 items-center">` so it centers on the first line at any font size.',
    },
    schema: [],
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const name = getJsxName(node.name) ?? "element";
        for (const attribute of node.attributes) {
          if (
            attribute.type !== "JSXAttribute" ||
            attribute.name.type !== "JSXIdentifier" ||
            attribute.name.name !== "className" ||
            attribute.value === null
          ) {
            continue;
          }
          const tokens = classNameText(attribute.value).split(/\s+/);
          const sized =
            name.endsWith("Icon") ||
            tokens.some((token) => SIZE_TOKEN.test(token));
          const nudge = tokens.find((token) => NUDGE_TOKEN.test(token));
          if (sized && nudge !== undefined) {
            context.report({
              node: attribute,
              messageId: "nudgedIcon",
              data: { name, token: nudge },
            });
          }
        }
      },
    };
  },
};

/**
 * Identifiers `node` mentions, and whether it calls `calleeName`, found by walking its children.
 * @param {any} node
 * @param {string} calleeName
 */
const scanExpression = (node, calleeName) => {
  /** @type {Set<string>} */
  const names = new Set();
  let calls = false;
  /** @param {any} current */
  const visit = (current) => {
    if (current === null || typeof current !== "object") {
      return;
    }
    if (Array.isArray(current)) {
      for (const child of current) {
        visit(child);
      }
      return;
    }
    if (current.type === "Identifier") {
      names.add(current.name);
    }
    if (
      current.type === "CallExpression" &&
      current.callee?.type === "Identifier" &&
      current.callee.name === calleeName
    ) {
      calls = true;
    }
    for (const [key, child] of Object.entries(current)) {
      if (key !== "parent") {
        visit(child);
      }
    }
  };
  visit(node);
  return { names, calls };
};

const MENU_GROUP_ROOT_IDENTIFIERS = new Set([
  "DropdownMenuGroup",
  "DropdownMenuRadioGroup",
]);
const MENU_GROUP_ROOT_PROPERTIES = new Set(["Group", "RadioGroup"]);
const MENU_GROUP_PART_IDENTIFIERS = new Set(["DropdownMenuLabel"]);
const MENU_GROUP_PART_PROPERTIES = new Set(["GroupLabel"]);
/** The shared primitive renders `Menu.GroupLabel`; callers wrap `DropdownMenuLabel`. */
const MENU_PRIMITIVE_FILE = "/components/ui/dropdown-menu.";

/**
 * @param {any} nameNode
 * @returns {{ objectName: string | null, property: string | null } | null}
 */
const jsxMember = (nameNode) => {
  if (!nameNode || nameNode.type !== "JSXMemberExpression") {
    return null;
  }
  const property =
    nameNode.property?.type === "JSXIdentifier" ? nameNode.property.name : null;
  let object = nameNode.object;
  while (object?.type === "JSXMemberExpression") {
    object = object.object;
  }
  const objectName = object?.type === "JSXIdentifier" ? object.name : null;
  return { objectName, property };
};

/**
 * @param {string | null} objectName
 */
const isMenuObject = (objectName) =>
  objectName !== null && /menu/iu.test(objectName);

/**
 * @param {any} nameNode
 */
const isMenuGroupPart = (nameNode) => {
  if (!nameNode) {
    return false;
  }
  if (nameNode.type === "JSXIdentifier") {
    return MENU_GROUP_PART_IDENTIFIERS.has(nameNode.name);
  }
  const member = jsxMember(nameNode);
  return (
    member !== null &&
    isMenuObject(member.objectName) &&
    member.property !== null &&
    MENU_GROUP_PART_PROPERTIES.has(member.property)
  );
};

/**
 * @param {any} nameNode
 */
const isMenuGroupRoot = (nameNode) => {
  if (!nameNode) {
    return false;
  }
  if (nameNode.type === "JSXIdentifier") {
    return MENU_GROUP_ROOT_IDENTIFIERS.has(nameNode.name);
  }
  const member = jsxMember(nameNode);
  return (
    member !== null &&
    isMenuObject(member.objectName) &&
    member.property !== null &&
    MENU_GROUP_ROOT_PROPERTIES.has(member.property)
  );
};

/**
 * A function that owns its returned JSX. Map callbacks stay open so a label inside
 * `items.map(() => <DropdownMenuLabel />)` can still see the group around the call.
 * @param {any} node
 */
const isComponentBoundary = (node) => {
  if (
    node.type !== "FunctionDeclaration" &&
    node.type !== "FunctionExpression" &&
    node.type !== "ArrowFunctionExpression"
  ) {
    return false;
  }
  const { parent } = node;
  return (
    parent?.type === "VariableDeclarator" ||
    parent?.type === "ExportDefaultDeclaration" ||
    parent?.type === "ExportNamedDeclaration" ||
    parent?.type === "Program" ||
    parent?.type === "MethodDefinition"
  );
};

const menuLabelInsideGroupRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require menu group labels to render inside Menu.Group or Menu.RadioGroup.",
    },
    messages: {
      outsideGroup:
        "Wrap {{name}} in DropdownMenuGroup, DropdownMenuRadioGroup, Menu.Group, or Menu.RadioGroup. Base UI throws MenuGroupContext error 31 when a group label renders outside a group.",
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename.replaceAll("\\", "/");
    if (filename.includes(MENU_PRIMITIVE_FILE)) {
      return {};
    }
    return {
      JSXOpeningElement(node) {
        if (!isMenuGroupPart(node.name)) {
          return;
        }
        let current = node.parent;
        while (current) {
          if (isComponentBoundary(current)) {
            break;
          }
          if (
            current.type === "JSXElement" &&
            isMenuGroupRoot(current.openingElement?.name)
          ) {
            return;
          }
          current = current.parent;
        }
        context.report({
          node,
          messageId: "outsideGroup",
          data: { name: getJsxName(node.name) ?? "group label" },
        });
      },
    };
  },
};

const BATCH_GATE_HELPER = "batchHasAnswered";

const batchGateUsesBatchHasAnsweredRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require batched reads that wait on the batch ahead (`batches[index - N]`) to gate through `batchHasAnswered`.",
    },
    messages: {
      handRolledGate:
        "Gate on the batch ahead with `batchHasAnswered` from `@pcobooster/client/query`. A hand-rolled settled check counts data restored from storage as answered, so every stale batch refetches at once and spends the user's Planning Center budget.",
    },
    schema: [],
  },
  create(context) {
    /** Names bound to `list[index - N]`: the batch a query waits on. */
    const gates = new Set();
    return {
      VariableDeclarator(node) {
        const { id, init } = node;
        if (
          id.type === "Identifier" &&
          init?.type === "MemberExpression" &&
          init.computed &&
          init.property.type === "BinaryExpression" &&
          init.property.operator === "-"
        ) {
          gates.add(id.name);
        }
      },
      Property(node) {
        if (
          node.key.type !== "Identifier" ||
          node.key.name !== "enabled" ||
          gates.size === 0
        ) {
          return;
        }
        const { names, calls } = scanExpression(node.value, BATCH_GATE_HELPER);
        if (calls || ![...names].some((name) => gates.has(name))) {
          return;
        }
        context.report({ node, messageId: "handRolledGate" });
      },
    };
  },
};

/** Text fields: native elements and the primitives that render one. */
const FIELD_NAMES = new Set([
  "input",
  "textarea",
  "select",
  "Input",
  "InputPrimitive",
  "Textarea",
  "InputGroupInput",
  "InputGroupTextarea",
  "CommandInput",
  "NativeSelect",
  "HighlightedTextarea",
]);
/** Input types that take no typed text, so iOS never zooms into them. */
const UNTYPED_INPUT_TYPES = new Set([
  "checkbox",
  "radio",
  "hidden",
  "range",
  "file",
  "color",
]);
const FIELD_TEXT_SIZE = /^text-(?:xs|sm|\[(\d+(?:\.\d+)?)(px|rem)\])$/u;
const MIN_FIELD_TEXT_PX = 16;
const REM_PX = 16;
const FINE_POINTER_VARIANT = /(?:^|:)pointer-fine:/u;
/** Parts of a field that don't decide its zoom: the file button and the placeholder. */
const FIELD_PART_VARIANT = /(?:^|:)(?:file|placeholder):/u;

/**
 * @param {string} base
 * @returns {boolean}
 */
const isSmallFieldText = (base) => {
  const match = FIELD_TEXT_SIZE.exec(base);
  if (match === null) {
    return false;
  }
  if (match[1] === undefined) {
    return true;
  }
  const size = Number(match[1]) * (match[2] === "rem" ? REM_PX : 1);
  return size < MIN_FIELD_TEXT_PX;
};

/**
 * iOS Safari zooms the page into a focused field whose text is under 16px and never zooms
 * back out. Fields keep 16px (`text-base`) on touch screens; a smaller desktop size goes
 * behind `pointer-fine:` (`md:pointer-fine:text-sm`), so the capability decides, not the width.
 */
const noSmallFieldTextRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow text under 16px on text fields unless gated to fine pointers (iOS zooms into the field).",
    },
    messages: {
      smallFieldText:
        "`{{token}}` makes this field's text smaller than 16px, so iOS zooms the page on focus. Keep `text-base` and gate the smaller size behind `pointer-fine:` (for example `md:pointer-fine:text-sm`).",
    },
    schema: [],
  },
  create(context) {
    /** @type {(name: string) => string} */
    let resolveIdentifier = () => "";
    return {
      Program(node) {
        resolveIdentifier = classConstantResolver(node);
      },
      JSXOpeningElement(node) {
        const name = getJsxName(node.name);
        if (name === null || !FIELD_NAMES.has(name)) {
          return;
        }
        const type = stringAttribute(node, "type");
        if (type !== null && UNTYPED_INPUT_TYPES.has(type)) {
          return;
        }
        for (const { variant, base } of classTokens(
          openingClassText(node, resolveIdentifier)
        )) {
          if (
            isSmallFieldText(base) &&
            !FINE_POINTER_VARIANT.test(variant) &&
            !FIELD_PART_VARIANT.test(variant)
          ) {
            context.report({
              node,
              messageId: "smallFieldText",
              data: { token: `${variant}${base}` },
            });
          }
        }
      },
    };
  },
};

const SCROLL_OVERFLOW_TOKEN = /^overflow(?:-([xy]))?-(?:auto|scroll)$/u;
/** Nodes that pass class strings up to the attribute or call that applies them. */
const CLASS_EXPRESSION_PARENTS = new Set([
  "ArrayExpression",
  "BinaryExpression",
  "CallExpression",
  "ConditionalExpression",
  "JSXExpressionContainer",
  "LogicalExpression",
  "ObjectExpression",
  "Property",
  "TemplateLiteral",
]);

/**
 * The whole class expression a string belongs to: its `className` attribute, or the
 * outermost `cn(...)`, array, or object holding it.
 * @param {any} node
 * @returns {any}
 */
const classExpressionRoot = (node) => {
  let current = node;
  while (current.parent) {
    if (current.parent.type === "JSXAttribute") {
      return current.parent;
    }
    if (!CLASS_EXPRESSION_PARENTS.has(current.parent.type)) {
      return current;
    }
    current = current.parent;
  }
  return current;
};

/**
 * Axes a class text scrolls on without saying what happens at the scroll edge.
 * @param {string} text
 * @returns {Set<string>}
 */
const scrollAxes = (text) => {
  const tokens = classTokens(text).map(({ base }) => base);
  /** @type {Set<string>} */
  const axes = new Set();
  for (const token of tokens) {
    const match = SCROLL_OVERFLOW_TOKEN.exec(token);
    if (match !== null) {
      for (const axis of match[1] === undefined ? ["x", "y"] : [match[1]]) {
        axes.add(axis);
      }
    }
  }
  return axes;
};

/** An overscroll class anywhere in source text, behind any variants and between quotes. */
const OVERSCROLL_IN_SOURCE =
  /(?:^|[\s"'`:])overscroll(?:-([xy]))?-(?:auto|contain|none)(?=$|[\s"'`,])/gu;

/**
 * @param {string} source
 * @returns {Set<string>}
 */
const overscrollAxes = (source) => {
  /** @type {Set<string>} */
  const axes = new Set();
  for (const match of source.matchAll(OVERSCROLL_IN_SOURCE)) {
    for (const axis of match[1] === undefined ? ["x", "y"] : [match[1]]) {
      axes.add(axis);
    }
  }
  return axes;
};

/**
 * An inner scroller that reaches its end hands the swipe to the page behind it: a menu
 * scrolls the document, a sheet rubber-bands the app, a sideways list triggers back
 * navigation. Each scroll container says what happens at its edge: `overscroll-contain`
 * for menus, sheets, and panels, `overscroll-x-contain` for sideways strips, or
 * `overscroll-auto` where chaining to the page is the intent.
 */
const scrollContainerOverscrollRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require an overscroll-* class beside overflow-auto/scroll so inner scrollers don't chain to the page.",
    },
    messages: {
      missingOverscroll:
        "This scroll container scrolls on {{axes}} without an overscroll class. Add `overscroll-contain` (or `overscroll-x-contain` for sideways strips) so its edge doesn't scroll the page, or `overscroll-auto` where chaining is intended.",
    },
    schema: [],
  },
  create(context) {
    /** @type {Set<unknown>} */
    const reported = new Set();
    /**
     * @param {any} node
     * @param {string} text
     */
    const check = (node, text) => {
      const scrolled = scrollAxes(text);
      if (scrolled.size === 0) {
        return;
      }
      const root = classExpressionRoot(node);
      if (reported.has(root)) {
        return;
      }
      const contained = overscrollAxes(context.sourceCode.getText(root));
      const missing = [...scrolled].filter((axis) => !contained.has(axis));
      if (missing.length === 0) {
        return;
      }
      reported.add(root);
      context.report({
        node,
        messageId: "missingOverscroll",
        data: { axes: missing.join(" and ") },
      });
    };
    return {
      Literal(node) {
        if (typeof node.value === "string") {
          check(node, node.value);
        }
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};

/** Calls whose string arguments are class names. */
const CLASS_FUNCTION_NAMES = new Set(["cn", "cva", "clsx", "cx", "twMerge"]);
const CLASS_BINDING_NAME = /(?:^c|C)lass(?:Name|es)?$/u;
const GRID_TEMPLATE_TOKEN = /^grid-(?:cols|rows)-\[(.+)\]$/u;
/** An `fr` size, unless it sits inside `minmax(...)`, which states its own minimum. */
const BARE_FR_TRACK = /(?:^|[_,(])(?:\d*\.)?\d+fr(?=$|[_,)])/u;
const MINMAX_TRACK = /minmax\([^()]*\)/gu;
/** Each `minmax(...)` (kept as is) or bare `fr` size (wrapped in `minmax(0,…)`). */
const FR_OUTSIDE_MINMAX =
  /(minmax\([^()]*\))|((?:^|[_,(\[]))((?:\d*\.)?\d+fr)(?=$|[_,)\]])/gu;
/** Classes that give a grid an explicit column template (or let it flow into columns). */
const COLUMN_TEMPLATE_TOKEN =
  /^(?:grid-cols-|auto-cols-|grid-flow-col|\[grid-template)/u;
const SOURCE_PUNCTUATION = /["'`,{}()]/gu;

/**
 * True when the string reaches the page as class names: a `className` attribute, a
 * `cn`/`cva` argument, or a constant named like `panelClassName`.
 * @param {any} node
 */
const isClassString = (node) => {
  let current = node;
  while (current.parent) {
    const { parent } = current;
    if (parent.type === "JSXAttribute") {
      return (
        parent.name.type === "JSXIdentifier" && parent.name.name === "className"
      );
    }
    if (
      parent.type === "CallExpression" &&
      parent.callee.type === "Identifier" &&
      CLASS_FUNCTION_NAMES.has(parent.callee.name)
    ) {
      return true;
    }
    if (parent.type === "VariableDeclarator") {
      return (
        parent.id.type === "Identifier" &&
        CLASS_BINDING_NAME.test(parent.id.name)
      );
    }
    if (!CLASS_EXPRESSION_PARENTS.has(parent.type)) {
      return false;
    }
    current = parent;
  }
  return false;
};

/**
 * A grid track's minimum is its content's min-content width unless the track says
 * otherwise. A bare `grid` (one implicit `auto` column) or a `1fr` track therefore grows to
 * fit one long unbreakable child, such as a truncated file name, and pushes the whole grid
 * past its container: a dialog's content spills out of its box. `grid-cols-N` and
 * `minmax(0,1fr)` floor the track at zero so `truncate` and `min-w-0` can do their job.
 */
const gridTracksShrinkRule = {
  meta: {
    type: "problem",
    fixable: "code",
    docs: {
      description:
        "Require grids to declare columns that can shrink: no bare `grid` and no `fr` tracks without `minmax(0,…)`.",
    },
    messages: {
      implicitColumn:
        "`{{token}}` without a column template sizes its one column to its widest child, so long text pushes it past its container. Add `grid-cols-1`, or `grid-cols-[max-content]` when the grid should size to its content.",
      bareFrTrack:
        "`{{token}}` has an `fr` track whose minimum is its content width, so long text widens the grid past its container. Write it as `minmax(0,1fr)`.",
    },
    schema: [],
  },
  create(context) {
    /**
     * Grid tokens in `node` with no column template where they apply: unprefixed, or
     * behind the same variant (`md:grid md:grid-cols-2`). `grid md:grid-cols-2` is bare
     * below `md`.
     * @param {any} node
     * @param {string} text
     */
    const untemplatedGrids = (node, text) => {
      const grids = classTokens(text).filter(({ base }) => base === "grid");
      if (grids.length === 0 || !isClassString(node)) {
        return [];
      }
      const templated = new Set(
        classTokens(
          context.sourceCode
            .getText(classExpressionRoot(node))
            .replaceAll(SOURCE_PUNCTUATION, " ")
        )
          .filter(({ base }) => COLUMN_TEMPLATE_TOKEN.test(base))
          .map(({ variant }) => variant)
      );
      return templated.has("")
        ? []
        : grids.filter(({ variant }) => !templated.has(variant));
    };
    /**
     * @param {string} text
     * @param {Set<string>} bareGridVariants
     */
    const fixedText = (text, bareGridVariants) =>
      text.replaceAll(/\S+/gu, (token) => {
        const [{ variant, base }] = classTokens(token);
        if (base === "grid" && bareGridVariants.has(variant)) {
          return `${token} ${variant}grid-cols-1`;
        }
        if (GRID_TEMPLATE_TOKEN.test(base)) {
          return token.replaceAll(
            FR_OUTSIDE_MINMAX,
            (match, inside, prefix, size) =>
              inside === undefined ? `${prefix}minmax(0,${size})` : match
          );
        }
        return token;
      });
    /**
     * @param {any} node
     * @param {string} text
     */
    const check = (node, text) => {
      const bareFr = classTokens(text).filter(({ base }) => {
        const template = GRID_TEMPLATE_TOKEN.exec(base);
        return (
          template !== null &&
          BARE_FR_TRACK.test(template[1].replaceAll(MINMAX_TRACK, "minmax"))
        );
      });
      const bareGrids = untemplatedGrids(node, text);
      if (bareFr.length === 0 && bareGrids.length === 0) {
        return;
      }
      const variants = new Set(bareGrids.map(({ variant }) => variant));
      /** A string literal rewrites in place; template pieces are left to a person. */
      const fix =
        node.type === "Literal"
          ? (/** @type {any} */ fixer) =>
              fixer.replaceText(
                node,
                `${node.raw[0]}${fixedText(node.value, variants)}${node.raw[0]}`
              )
          : undefined;
      for (const { variant, base } of bareFr) {
        context.report({
          node,
          messageId: "bareFrTrack",
          data: { token: `${variant}${base}` },
          fix,
        });
      }
      for (const { variant, base } of bareGrids) {
        context.report({
          node,
          messageId: "implicitColumn",
          data: { token: `${variant}${base}` },
          fix,
        });
      }
    };
    return {
      Literal(node) {
        if (typeof node.value === "string") {
          check(node, node.value);
        }
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};

/** Fields whose label says they search or filter a list as you type. */
const SEARCH_FIELD_LABEL = /^(?:search|filter)\b/iu;
/** `CommandInput` always searches, so the primitive sets these hints itself. */
const TYPED_FIELD_NAMES = new Set(["input", "Input", "InputGroupInput"]);
const NON_DIGIT = /[^\d\s]/u;

/**
 * The software keyboard should fit the field. A search box labels its return key "search"
 * and leaves names and queries alone (no capitals, no autocorrect); a numeric keypad can't
 * type the separators a placeholder like `m:ss` asks for.
 */
const fieldKeyboardHintsRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require keyboard hints on search fields and forbid the numeric keypad for values with separators.",
    },
    messages: {
      searchKeyboard:
        'Search and filter fields set `enterKeyHint="search"`, `autoCapitalize="none"`, and `autoCorrect="off"` so the phone keyboard fits a query.',
      numericSeparators:
        '`inputMode="numeric"` opens a digits-only keypad on iPhone, which can\'t type the "{{placeholder}}" this field asks for. Drop the inputMode or accept digits only.',
    },
    schema: [],
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const name = getJsxName(node.name);
        if (name === null || !TYPED_FIELD_NAMES.has(name)) {
          return;
        }
        const placeholder = stringAttribute(node, "placeholder");
        const label = stringAttribute(node, "aria-label");
        const searches = [placeholder, label].some(
          (text) => text !== null && SEARCH_FIELD_LABEL.test(text)
        );
        if (
          searches &&
          !["enterKeyHint", "autoCapitalize", "autoCorrect"].every(
            (attribute) => hasAttribute(node, attribute)
          )
        ) {
          context.report({ node, messageId: "searchKeyboard" });
        }
        if (
          stringAttribute(node, "inputMode") === "numeric" &&
          placeholder !== null &&
          NON_DIGIT.test(placeholder)
        ) {
          context.report({
            node,
            messageId: "numericSeparators",
            data: { placeholder },
          });
        }
      },
    };
  },
};

/**
 * Corner radii in px for `--radius: 0.625rem` (packages/design-tokens/src/tokens.css).
 * `rounded-full` is left out: pills and avatars do not hug a container corner.
 */
const RADIUS_PX = new Map([
  ["rounded-none", 0],
  ["rounded-xs", 2],
  ["rounded", 4],
  ["rounded-sm", 6],
  ["rounded-md", 8],
  ["rounded-lg", 10],
  ["rounded-xl", 14],
  ["rounded-2xl", 18],
  ["rounded-3xl", 22],
  ["rounded-4xl", 26],
]);
const ARBITRARY_LENGTH = /^\[(\d+(?:\.\d+)?)(px|rem)\]$/;
const SPACING_STEP = /^\d+(?:\.\d+)?$/;
const SPACING_PX_PER_STEP = 4;
const UNIFORM_PADDING = /^p-(.+)$/;
const AXIS_PADDING = /^p([xy])-(.+)$/;
/** Base UI and cmdk popups whose items hug the popup's corners. */
const CONCENTRIC_SURFACE_NAMES = new Set(["Popup", "CommandPrimitive"]);
const CONCENTRIC_ITEM_NAMES = new Set([
  "Item",
  "CheckboxItem",
  "RadioItem",
  "SubmenuTrigger",
]);

/**
 * @param {string} value
 * @returns {number | null}
 */
const arbitraryPx = (value) => {
  const match = ARBITRARY_LENGTH.exec(value);
  if (!match) {
    return null;
  }
  const amount = Number(match[1]);
  return match[2] === "rem" ? amount * REM_PX : amount;
};

/**
 * @param {string} value spacing suffix such as `1.5`, `px`, or `[6px]`
 * @returns {number | null}
 */
const spacingPx = (value) => {
  if (value === "px") {
    return 1;
  }
  if (SPACING_STEP.test(value)) {
    return Number(value) * SPACING_PX_PER_STEP;
  }
  return arbitraryPx(value);
};

/**
 * Resting (unprefixed) corner radius and corner inset of a class list.
 * @param {string} text
 * @returns {{ radius: number | null, inset: number | null }}
 */
const cornerGeometry = (text) => {
  let radius = null;
  /** @type {{ x: number | null, y: number | null }} */
  const inset = { x: null, y: null };
  for (const { variant, base } of classTokens(text)) {
    if (variant !== "") {
      continue;
    }
    if (RADIUS_PX.has(base)) {
      radius = RADIUS_PX.get(base) ?? null;
      continue;
    }
    if (base.startsWith("rounded-[")) {
      radius = arbitraryPx(base.slice("rounded-".length));
      continue;
    }
    const uniform = UNIFORM_PADDING.exec(base);
    if (uniform) {
      const px = spacingPx(uniform[1]);
      inset.x = px;
      inset.y = px;
      continue;
    }
    const axis = AXIS_PADDING.exec(base);
    if (axis) {
      inset[axis[1] === "x" ? "x" : "y"] = spacingPx(axis[2]);
    }
  }
  const corner =
    inset.x === null || inset.y === null ? null : Math.min(inset.x, inset.y);
  return { radius, inset: corner };
};

/**
 * JSX children of an element, through fragments, conditionals, and `.map` callbacks.
 * @param {unknown} node
 * @param {import("oxlint/plugins-dev").JSXElement[]} out
 */
const collectChildElements = (node, out) => {
  if (!node || typeof node !== "object") {
    return;
  }
  if (node.type === "CallExpression") {
    for (const argument of node.arguments) {
      if (argument.type !== "ArrowFunctionExpression") {
        continue;
      }
      if (argument.body.type !== "BlockStatement") {
        collectChildElements(argument.body, out);
        continue;
      }
      for (const statement of argument.body.body) {
        if (statement.type === "ReturnStatement") {
          collectChildElements(statement.argument, out);
        }
      }
    }
    return;
  }
  if (node.type === "JSXExpressionContainer") {
    collectChildElements(node.expression, out);
    return;
  }
  if (node.type === "JSXFragment") {
    for (const child of node.children) {
      collectChildElements(child, out);
    }
    return;
  }
  collectJsxElements(node, out);
};

/**
 * Resting corners of shared primitives, for call sites that do not restate them.
 * Keep in step with the primitives in components/ui.
 */
const PRIMITIVE_CORNERS = new Map([
  ["PopoverContent", { radius: 22, inset: 0 }],
  ["ResponsivePopoverContent", { radius: 22, inset: 0 }],
  ["DropdownMenuContent", { radius: 22, inset: 6 }],
  ["DropdownMenuSubContent", { radius: 22, inset: 6 }],
  ["Command", { radius: 22, inset: 4 }],
  ["DialogContent", { radius: 26, inset: 24 }],
  ["SelectionPickerShell", { radius: 18, inset: 6 }],
  ["DropdownMenuItem", { radius: 14, inset: null }],
  ["CommandItem", { radius: 18, inset: null }],
  ["SelectionPickerOption", { radius: 10, inset: null }],
  ["SelectionPickerCommandItem", { radius: 10, inset: null }],
]);

const concentricRadiusRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require corner-hugging children of a padded rounded surface to use a radius no larger than the surface radius minus the padding between them, so nested corners stay concentric.",
    },
    messages: {
      tooRound:
        "This corner ({{inner}}px) is rounder than its container allows: {{outer}}px radius minus {{inset}}px padding leaves {{max}}px. Use a radius of at most {{max}}px (for example `rounded-xl` inside `rounded-3xl p-1.5`).",
    },
    schema: [],
  },
  create(context) {
    /** @type {(name: string) => string} */
    let resolve = () => "";
    /** @type {{ outer: number, inset: number }[]} */
    const surfaces = [];
    /** @type {{ node: import("oxlint/plugins-dev").JSXOpeningElement, radius: number }[]} */
    const items = [];

    /**
     * Own classes first, then the primitive's resting corner.
     * @param {import("oxlint/plugins-dev").JSXOpeningElement} opening
     */
    const geometryOf = (opening) => {
      const own = cornerGeometry(openingClassText(opening, resolve));
      const name = getJsxName(opening.name);
      const primitive =
        opening.name.type === "JSXIdentifier" && name !== null
          ? PRIMITIVE_CORNERS.get(name)
          : undefined;
      return {
        radius: own.radius ?? primitive?.radius ?? null,
        inset: own.inset ?? primitive?.inset ?? null,
      };
    };

    /**
     * @param {import("oxlint/plugins-dev").JSXOpeningElement} node
     * @param {number} inner
     * @param {number} outer
     * @param {number} inset
     */
    const check = (node, inner, outer, inset) => {
      const max = Math.max(0, outer - inset);
      if (inner <= max) {
        return;
      }
      context.report({
        node,
        messageId: "tooRound",
        data: {
          inner: String(inner),
          outer: String(outer),
          inset: String(inset),
          max: String(max),
        },
      });
    };

    /**
     * Check the rounded children, and through a lone square wrapper (which reaches the
     * corners) the rounded children it holds, adding its padding.
     * @param {import("oxlint/plugins-dev").JSXElement} element
     * @param {number} outer
     * @param {number} inset
     */
    const checkDescendants = (element, outer, inset) => {
      /** @type {import("oxlint/plugins-dev").JSXElement[]} */
      const children = [];
      for (const child of element.children) {
        collectChildElements(child, children);
      }
      for (const child of children) {
        const geometry = geometryOf(child.openingElement);
        if (geometry.radius === null) {
          if (children.length === 1) {
            checkDescendants(child, outer, inset + (geometry.inset ?? 0));
          }
          continue;
        }
        check(child.openingElement, geometry.radius, outer, inset);
      }
    };

    return {
      Program(node) {
        resolve = classConstantResolver(node);
      },
      JSXElement(node) {
        const opening = node.openingElement;
        const geometry = geometryOf(opening);
        if (geometry.radius === null) {
          return;
        }
        const name = getJsxName(opening.name);
        if (name !== null && CONCENTRIC_ITEM_NAMES.has(name)) {
          items.push({ node: opening, radius: geometry.radius });
        }
        if (name !== null && CONCENTRIC_SURFACE_NAMES.has(name)) {
          surfaces.push({ outer: geometry.radius, inset: geometry.inset ?? 0 });
        }
        checkDescendants(node, geometry.radius, geometry.inset ?? 0);
      },
      "Program:exit"() {
        for (const item of items) {
          for (const surface of surfaces) {
            check(item.node, item.radius, surface.outer, surface.inset);
          }
        }
      },
    };
  },
};

const NEGATIVE_MARGIN = /^-m([xy]?)-(.+)$/;
/** `<Item>` corners from its `size` variant (components/ui/item.tsx). */
const ITEM_RADIUS = 18;
const ITEM_SIZE_RADIUS = new Map([
  ["row", 10],
  ["pill", 26],
]);

const MAX_INSET_DEPTH = 8;

/**
 * Resting padding per axis of a class list; unset axes are 0.
 * @param {string} text
 */
const axisPadding = (text) => {
  const inset = { x: 0, y: 0 };
  for (const { variant, base } of classTokens(text)) {
    if (variant !== "") {
      continue;
    }
    const uniform = UNIFORM_PADDING.exec(base);
    if (uniform) {
      const px = spacingPx(uniform[1]) ?? 0;
      inset.x = px;
      inset.y = px;
      continue;
    }
    const axis = AXIS_PADDING.exec(base);
    if (axis) {
      inset[axis[1] === "x" ? "x" : "y"] = spacingPx(axis[2]) ?? 0;
    }
  }
  return inset;
};

/**
 * Resting negative margin per axis, which pulls an element toward the edge.
 * @param {string} text
 */
const axisBleed = (text) => {
  const bleed = { x: 0, y: 0 };
  for (const { variant, base } of classTokens(text)) {
    const match = variant === "" ? NEGATIVE_MARGIN.exec(base) : null;
    if (!match) {
      continue;
    }
    const px = spacingPx(match[2]) ?? 0;
    if (match[1] !== "y") {
      bleed.x = px;
    }
    if (match[1] !== "x") {
      bleed.y = px;
    }
  }
  return bleed;
};

/**
 * True when the element is the first or last element child of its JSX parent, or one of
 * many rows mapped from a list, so it can touch the parent's top or bottom edge.
 * @param {import("oxlint/plugins-dev").JSXElement} element
 * @param {import("oxlint/plugins-dev").JSXElement} parent
 */
const touchesVerticalEdge = (element, parent) => {
  /** @type {{ element: import("oxlint/plugins-dev").JSXElement, optional: boolean }[]} */
  const siblings = [];
  for (const child of parent.children) {
    /** @type {import("oxlint/plugins-dev").JSXElement[]} */
    const found = [];
    collectChildElements(child, found);
    const optional =
      child.type === "JSXExpressionContainer" &&
      (child.expression.type === "ConditionalExpression" ||
        child.expression.type === "LogicalExpression");
    for (const each of found) {
      siblings.push({ element: each, optional });
    }
  }
  const index = siblings.findIndex((sibling) => sibling.element === element);
  if (index === -1) {
    return false;
  }
  const onlyOptional = (list) => list.every((sibling) => sibling.optional);
  return (
    onlyOptional(siblings.slice(0, index)) ||
    onlyOptional(siblings.slice(index + 1))
  );
};

/**
 * The JSX element that contains this one, through child slots and props such as
 * `trigger={<Item />}`.
 * @param {import("oxlint/plugins-dev").JSXElement} element
 * @returns {{ parent: import("oxlint/plugins-dev").JSXElement, viaProp: boolean } | null}
 */
const jsxContainer = (element) => {
  let viaProp = false;
  let node = element.parent;
  while (node) {
    if (node.type === "JSXAttribute") {
      viaProp = true;
    }
    if (node.type === "JSXElement") {
      return { parent: node, viaProp };
    }
    if (
      node.type === "ArrowFunctionExpression" &&
      node.parent?.type !== "CallExpression" &&
      node.parent?.type !== "JSXExpressionContainer"
    ) {
      return null;
    }
    if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression"
    ) {
      return null;
    }
    node = node.parent;
  }
  return null;
};

const evenCornerInsetRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require a rounded element in a rounded surface's corner to sit as far from the side as from the top or bottom edge.",
    },
    messages: {
      uneven:
        "This rounded element sits {{x}}px from the sides of its rounded container but {{y}}px from the top or bottom. Use the same inset on both axes so the corner gap is even.",
    },
    schema: [],
  },
  create(context) {
    /** @type {(name: string) => string} */
    let resolve = () => "";

    /** @param {import("oxlint/plugins-dev").JSXOpeningElement} opening */
    const classesOf = (opening) => openingClassText(opening, resolve);

    /** @param {import("oxlint/plugins-dev").JSXOpeningElement} opening */
    const radiusOf = (opening) => {
      const own = cornerGeometry(classesOf(opening)).radius;
      const name = getJsxName(opening.name);
      if (
        own !== null ||
        name === null ||
        opening.name.type !== "JSXIdentifier"
      ) {
        return own;
      }
      if (name === ITEM_NAME) {
        return (
          ITEM_SIZE_RADIUS.get(stringAttribute(opening, "size") ?? "") ??
          ITEM_RADIUS
        );
      }
      return PRIMITIVE_CORNERS.get(name)?.radius ?? null;
    };

    /** @param {import("oxlint/plugins-dev").JSXOpeningElement} opening */
    const surfaceOf = (opening) => {
      const own = cornerGeometry(classesOf(opening));
      const name = getJsxName(opening.name);
      const primitive =
        opening.name.type === "JSXIdentifier" && name !== null
          ? PRIMITIVE_CORNERS.get(name)
          : undefined;
      if (own.radius === null && primitive === undefined) {
        return null;
      }
      const padding = axisPadding(classesOf(opening));
      if (own.inset === null && primitive?.inset !== null && primitive) {
        return { x: primitive.inset, y: primitive.inset };
      }
      return padding;
    };

    return {
      Program(node) {
        resolve = classConstantResolver(node);
      },
      JSXElement(node) {
        const radius = radiusOf(node.openingElement);
        if (radius === null || radius === 0) {
          return;
        }
        const bleed = axisBleed(classesOf(node.openingElement));
        let x = -bleed.x;
        let y = -bleed.y;
        let element = node;
        for (let depth = 0; depth < MAX_INSET_DEPTH; depth += 1) {
          const container = jsxContainer(element);
          if (container === null) {
            return;
          }
          const { parent, viaProp } = container;
          if (!(viaProp || touchesVerticalEdge(element, parent))) {
            return;
          }
          const surface = surfaceOf(parent.openingElement);
          if (surface !== null) {
            x += surface.x;
            y += surface.y;
            if (x !== y && x >= 0 && y >= 0) {
              context.report({
                node: node.openingElement,
                messageId: "uneven",
                data: { x: String(x), y: String(y) },
              });
            }
            return;
          }
          if (!viaProp) {
            const padding = axisPadding(classesOf(parent.openingElement));
            x += padding.x;
            y += padding.y;
          }
          element = parent;
        }
      },
    };
  },
};

export default {
  meta: {
    name: "local",
  },
  rules: {
    "batch-gate-uses-batch-has-answered": batchGateUsesBatchHasAnsweredRule,
    "flush-list-rows": flushListRowsRule,
    "grid-tracks-shrink": gridTracksShrinkRule,
    "no-absolute-input-overlay": noAbsoluteInputOverlayRule,
    "no-backdrop-blur": noBackdropBlurRule,
    "no-clipped-surface": noClippedSurfaceRule,
    "no-popover-content-padding": noPopoverContentPaddingRule,
    "no-overlay-section-border-b": noOverlaySectionBorderRule,
    "no-nudged-icon": noNudgedIconRule,
    "no-transition-colors": noTransitionColorsRule,
    "no-animate-spin": noAnimateSpinRule,
    "menu-label-inside-group": menuLabelInsideGroupRule,
    "prefer-shared-controls": preferSharedControlsRule,
    "no-small-field-text": noSmallFieldTextRule,
    "scroll-container-overscroll": scrollContainerOverscrollRule,
    "field-keyboard-hints": fieldKeyboardHintsRule,
    "concentric-radius": concentricRadiusRule,
    "even-corner-inset": evenCornerInsetRule,
  },
};

export {
  batchGateUsesBatchHasAnsweredRule,
  flushListRowsRule,
  gridTracksShrinkRule,
  noAbsoluteInputOverlayRule,
  noBackdropBlurRule,
  noClippedSurfaceRule,
  noNudgedIconRule,
  noOverlaySectionBorderRule,
  noPopoverContentPaddingRule,
  menuLabelInsideGroupRule,
  noTransitionColorsRule,
  noAnimateSpinRule,
  preferSharedControlsRule,
  noSmallFieldTextRule,
  scrollContainerOverscrollRule,
  fieldKeyboardHintsRule,
  concentricRadiusRule,
  evenCornerInsetRule,
};
