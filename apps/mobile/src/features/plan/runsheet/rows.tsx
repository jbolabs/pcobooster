import {
  Button,
  ContextMenu,
  HStack,
  Image,
  Menu,
  Section,
  SwipeActions,
  VStack,
} from "@expo/ui/swift-ui";
import {
  accessibilityIdentifier,
  frame,
  font as swiftFont,
  foregroundStyle,
  listRowBackground,
  listRowInsets,
  listRowSeparator,
  listRowSeparatorTint,
  moveDisabled,
  onAppear,
  onTapGesture,
  padding,
  textCase,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { KeyTransition } from "@pcobooster/planning-center-models/plan-set-insights";
import type {
  ArrangementOption,
  KeyOption,
  PlanItem,
  SongOptionSet,
} from "@pcobooster/planning-center-models/types";
import { Linking } from "react-native";

import { resolvedTokenColor, useColorVariant } from "../../../design/colors";
import { useToasts } from "../../../lib/toasts";
import { NativeLabel } from "../native-label";
import {
  isCurrentKey,
  itemTitle,
  keyedArrangements,
  lengthLabel,
  recentLabel,
  rowFacts,
  songUrl,
} from "./formatting";

const destructiveButton = { role: "destructive" } as const;

export interface RowActions {
  open: (item: PlanItem) => void;
  remove: (item: PlanItem) => void;
  insert: (kind: "song" | "header" | "item", afterItemId?: string) => void;
  replace: (item: PlanItem) => void;
  move: (item: PlanItem, offset: -1 | 1) => void;
  length: (item: PlanItem, length: number | null) => void;
  key: (item: PlanItem, arrangement: ArrangementOption, key: KeyOption) => void;
  transition: (item: PlanItem, transition: KeyTransition) => void;
  /** Loads a song's arrangements on clear intent (its long-press preview). */
  prefetch: (item: PlanItem) => void;
}
interface RowProps {
  item: PlanItem;
  canEdit: boolean;
  canMove: boolean;
  nextIsHeader: boolean;
  index: number;
  count: number;
  sectionLength: number | null;
  sectionEnd: string;
  recent: number | null;
  options?: SongOptionSet;
  transition?: KeyTransition;
  actions: RowActions;
}

const insertKinds = [
  { kind: "song", label: "Song", symbol: "music.note" },
  { kind: "header", label: "Header", symbol: "textformat" },
  { kind: "item", label: "Item", symbol: "text.alignleft" },
] as const;

const InsertMenu = ({
  actions,
  afterItemId,
}: {
  actions: RowActions;
  afterItemId: string;
}) =>
  insertKinds.map(({ kind, label, symbol }) => (
    <Button
      key={kind}
      label={label}
      systemImage={symbol}
      onPress={() => {
        actions.insert(kind, afterItemId);
      }}
    />
  ));

const RowContent = (props: RowProps) => {
  const { item, actions, canEdit, options, recent } = props;
  const variant = useColorVariant();
  if (item.itemType === "header") {
    return (
      <HStack
        spacing={8}
        modifiers={[
          padding({ top: 16, bottom: 2 }),
          onTapGesture(() => {
            actions.open(item);
          }),
        ]}
      >
        <VStack
          modifiers={[
            frame({ maxWidth: Infinity, alignment: "leading" }),
            textCase("uppercase"),
          ]}
        >
          <NativeLabel font="footnote" weight="semibold" color="inkSecondary">
            {itemTitle(item)}
          </NativeLabel>
        </VStack>
        {props.sectionLength === null ? null : (
          <NativeLabel font="meta" color="inkTertiary" tabular>
            {lengthLabel(props.sectionLength)}
          </NativeLabel>
        )}
        {canEdit ? (
          <Menu
            label={
              <Image
                systemName="plus"
                modifiers={[
                  frame({ width: 24, height: 28 }),
                  swiftFont({ textStyle: "subheadline", weight: "semibold" }),
                  foregroundStyle(resolvedTokenColor("inkSecondary", variant)),
                ]}
              />
            }
            modifiers={[accessibilityIdentifier(`run-sheet-insert-${item.id}`)]}
          >
            <InsertMenu actions={actions} afterItemId={props.sectionEnd} />
          </Menu>
        ) : null}
      </HStack>
    );
  }
  const facts = rowFacts(item, options, recent !== null);
  return (
    <HStack
      alignment="firstTextBaseline"
      spacing={12}
      modifiers={[
        padding({ vertical: 6 }),
        onTapGesture(() => {
          actions.open(item);
        }),
        accessibilityIdentifier(`run-sheet-row-${item.id}`),
      ]}
    >
      <VStack
        alignment="leading"
        modifiers={[frame({ width: 46, alignment: "leading" })]}
      >
        <NativeLabel font="meta" color="inkSecondary" tabular>
          {lengthLabel(item.length)}
        </NativeLabel>
        {item.servicePosition === "during" ? null : (
          <NativeLabel font="caption2" color="inkTertiary">
            {item.servicePosition === "pre" ? "before" : "after"}
          </NativeLabel>
        )}
      </VStack>
      <VStack
        alignment="leading"
        spacing={3}
        modifiers={[frame({ maxWidth: Infinity, alignment: "leading" })]}
      >
        <HStack spacing={4}>
          {item.itemType === "media" ? (
            <Image
              systemName="play.rectangle"
              modifiers={[
                swiftFont({ textStyle: "footnote" }),
                foregroundStyle(resolvedTokenColor("inkTertiary", variant)),
              ]}
            />
          ) : null}
          <NativeLabel>{itemTitle(item)}</NativeLabel>
        </HStack>
        {facts === "" && recent === null ? null : (
          <HStack spacing={8}>
            {facts === "" ? null : (
              <NativeLabel font="meta" color="inkTertiary">
                {facts}
              </NativeLabel>
            )}
            {recent === null ? null : (
              <NativeLabel font="meta" color="statusPendingText">
                ◷ {recentLabel(recent)}
              </NativeLabel>
            )}
          </HStack>
        )}
        {item.description === "" ? null : (
          <NativeLabel font="meta" color="inkSecondary" lines={2}>
            {item.description}
          </NativeLabel>
        )}
      </VStack>
      {item.song === null ? null : (
        <NativeLabel font="meta" color="inkSecondary">
          {item.key?.startingKey ?? item.key?.name ?? "—"}
        </NativeLabel>
      )}
    </HStack>
  );
};

const RowMenu = ({
  item,
  actions,
  canEdit,
  index,
  count,
  options,
  transition,
}: RowProps) => {
  const toasts = useToasts();
  const keyed = keyedArrangements(options);
  return (
    <>
      <Button
        label={item.itemType === "header" ? "Rename" : "Details"}
        systemImage="info.circle"
        onPress={() => {
          actions.open(item);
        }}
      />
      {transition === undefined ? null : (
        <Button
          label="Key transition"
          systemImage="key"
          onPress={() => {
            actions.transition(item, transition);
          }}
        />
      )}
      {canEdit && item.song !== null ? (
        <>
          {keyed.length === 0 ? null : (
            <Menu label="Key" systemImage="key">
              {keyed.map((arrangement) => (
                <Section key={arrangement.id} title={arrangement.name}>
                  {arrangement.keys.map((key) => (
                    <Button
                      key={key.id}
                      label={key.startingKey ?? key.name}
                      systemImage={
                        isCurrentKey(item, arrangement, key)
                          ? "checkmark"
                          : undefined
                      }
                      onPress={() => {
                        actions.key(item, arrangement, key);
                      }}
                    />
                  ))}
                </Section>
              ))}
            </Menu>
          )}
          <Button
            label="Replace Song"
            systemImage="arrow.triangle.2.circlepath"
            onPress={() => {
              actions.replace(item);
            }}
          />
        </>
      ) : null}
      {canEdit ? (
        <>
          <Menu
            label="Add Below"
            systemImage="text.line.first.and.arrowtriangle.forward"
          >
            <InsertMenu actions={actions} afterItemId={item.id} />
          </Menu>
          <Section>
            {index === 0 ? null : (
              <Button
                label="Move Up"
                systemImage="arrow.up"
                onPress={() => {
                  actions.move(item, -1);
                }}
              />
            )}
            {index === count - 1 ? null : (
              <Button
                label="Move Down"
                systemImage="arrow.down"
                onPress={() => {
                  actions.move(item, 1);
                }}
              />
            )}
          </Section>
        </>
      ) : null}
      {item.song === null ? null : (
        <Section>
          <Button
            label="Open in Planning Center"
            systemImage="arrow.up.right.square"
            onPress={() => {
              void (async () => {
                try {
                  await Linking.openURL(songUrl(item.song?.id ?? ""));
                } catch {
                  toasts.showError("Couldn't open Planning Center.");
                }
              })();
            }}
          />
        </Section>
      )}
      {canEdit ? (
        <Section>
          <Button
            {...destructiveButton}
            label="Remove"
            systemImage="trash"
            onPress={() => {
              actions.remove(item);
            }}
          />
        </Section>
      ) : null}
    </>
  );
};

export const RunSheetRow = (props: RowProps) => {
  const variant = useColorVariant();
  const header = props.item.itemType === "header";
  return (
    <SwipeActions
      modifiers={[
        listRowBackground(resolvedTokenColor("surfaceCanvas", variant)),
        listRowInsets({
          top: header ? 4 : 8,
          leading: 16,
          bottom: header ? 4 : 8,
          trailing: 12,
        }),
        listRowSeparator(header ? "hidden" : "visible", "top"),
        listRowSeparator(
          header || props.nextIsHeader ? "hidden" : "visible",
          "bottom"
        ),
        listRowSeparatorTint(resolvedTokenColor("hairline", variant)),
        moveDisabled(!props.canMove),
      ]}
    >
      <ContextMenu>
        <ContextMenu.Trigger>
          <RowContent {...props} />
        </ContextMenu.Trigger>
        <ContextMenu.Preview>
          <VStack
            alignment="leading"
            spacing={12}
            modifiers={[
              padding({ all: 20 }),
              frame({ width: 340 }),
              onAppear(() => {
                props.actions.prefetch(props.item);
              }),
            ]}
          >
            <NativeLabel font="pageTitle">{itemTitle(props.item)}</NativeLabel>
            <NativeLabel color="inkSecondary">
              {rowFacts(props.item, props.options, false)}
            </NativeLabel>
            <NativeLabel>{props.item.description}</NativeLabel>
          </VStack>
        </ContextMenu.Preview>
        <ContextMenu.Items>
          <RowMenu {...props} />
        </ContextMenu.Items>
      </ContextMenu>
      {props.canEdit ? (
        <>
          <SwipeActions.Actions edge="trailing" allowsFullSwipe>
            <Button
              {...destructiveButton}
              label="Remove"
              systemImage="trash"
              onPress={() => {
                props.actions.remove(props.item);
              }}
            />
          </SwipeActions.Actions>
          <SwipeActions.Actions edge="leading" allowsFullSwipe={false}>
            <Button
              label="Add Song Below"
              systemImage="music.note"
              modifiers={[tint(resolvedTokenColor("inkFill", variant))]}
              onPress={() => {
                props.actions.insert("song", props.item.id);
              }}
            />
          </SwipeActions.Actions>
        </>
      ) : null}
    </SwipeActions>
  );
};
