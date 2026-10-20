import { PlanToolbar } from "../plan-toolbar";

export const RunSheetToolbar = ({
  toolbar,
  canReorder,
  reordering,
  onReorder,
  canAdd,
  onAdd,
}: {
  toolbar: Parameters<typeof PlanToolbar>[0];
  /** Reorder needs edit access and at least two items. */
  canReorder: boolean;
  reordering: boolean;
  onReorder: () => void;
  canAdd: boolean;
  onAdd: (kind: "song" | "item" | "header") => void;
}) => {
  const { onOpenPlanningCenter } = toolbar;
  return (
    <PlanToolbar
      {...toolbar}
      rightItems={() => [
        ...(canAdd
          ? [
              {
                type: "menu" as const,
                label: "Add",
                accessibilityLabel: "Add to order",
                menu: {
                  items: [
                    {
                      type: "action" as const,
                      label: "Song",
                      onPress: () => {
                        onAdd("song");
                      },
                    },
                    {
                      type: "action" as const,
                      label: "Item",
                      onPress: () => {
                        onAdd("item");
                      },
                    },
                    {
                      type: "action" as const,
                      label: "Section",
                      onPress: () => {
                        onAdd("header");
                      },
                    },
                  ],
                },
              },
            ]
          : []),
        {
          type: "menu",
          label: "More",
          icon: { type: "sfSymbol", name: "ellipsis" },
          width: 37,
          sharesBackground: true,
          menu: {
            items: [
              ...(canReorder
                ? [
                    {
                      type: "action" as const,
                      label: reordering ? "Done Reordering" : "Reorder",
                      onPress: () => {
                        onReorder();
                      },
                    },
                  ]
                : []),
              ...(onOpenPlanningCenter === undefined
                ? []
                : [
                    {
                      type: "action" as const,
                      label: "Open in Planning Center",
                      onPress: onOpenPlanningCenter,
                    },
                  ]),
            ],
          },
        },
      ]}
    />
  );
};
