import { Host, Picker, Text as SwiftText } from "@expo/ui/swift-ui";
import { pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";
import type {
  PlanItem,
  PlanItemServicePosition,
} from "@pcobooster/planning-center-models/types";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { TextInput } from "react-native";

import { useFeatures } from "../../../app-shell/features";
import { useProductClient } from "../../../app-shell/queries";
import { useVisibleQuery as useQuery } from "../../../app-shell/visible-queries";
import { PillButton } from "../../../components/pill-button";
import { AppText } from "../../../design/app-text";
import { colors } from "../../../design/colors";
import { playHaptic } from "../../../design/haptics";
import { useToasts } from "../../../lib/toasts";
import { songFilesHref } from "../../songs/preview-reads";
import { songChartHref, songHref } from "../../songs/reads";
import { useSongPath } from "../../songs/use-song-path";
import type { PlanContentWriter } from "../content-writes";
import { EditorSection, EditorSheet } from "../editor-sheet";
import { ReadStatus } from "../read-status";
import type { PlanIds } from "../reads";
import { requestItemRemove } from "./confirm-remove";
import { editorTitle } from "./formatting";
import { ItemDraft } from "./item-draft";
import { songReads } from "./reads";
import { SongFields } from "./song-fields";
import { SongHistory, usePlanDate } from "./song-history";

/** History rows the item's details show before "Show All". */
const DETAIL_HISTORY_ROWS = 6;
const inputStyle = { color: colors.ink, fontSize: 17, minHeight: 32 } as const;

export const ItemEditor = ({
  item,
  ids,
  writer,
  canEdit,
  onClose,
  onRemove,
  onReplace,
}: {
  item: PlanItem;
  ids: PlanIds;
  writer: PlanContentWriter;
  canEdit: boolean;
  onClose: () => void;
  onRemove: () => void;
  onReplace: () => void;
}) => {
  const initialItem = useRef(item);
  const router = useRouter();
  const songPath = useSongPath();
  const features = useFeatures();
  const editor = useRef<ItemDraft | null>(null);
  const [draft, setDraft] = useState(() => new ItemDraft(item).draft);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState(false);
  const context = useProductClient();
  const toasts = useToasts();
  const planDate = usePlanDate(ids);
  const cache = useQueryClient();
  const optionsRead = songReads.options(
    context,
    ids.serviceTypeId,
    item.song?.id ?? ""
  );
  const options = useQuery({ ...optionsRead, enabled: item.song !== null });
  const optionsKey = useRef(optionsRead.queryKey);
  const persist = async () => {
    if (!canEdit) {
      return;
    }
    setError((await editor.current?.commit(writer)) ?? null);
  };
  useEffect(() => {
    // Read at save, so options cached before the form opened still name the pick.
    const session = new ItemDraft(initialItem.current, () =>
      cache.getQueryData(optionsKey.current)
    );
    editor.current = session;
    return () => {
      if (canEdit) {
        void session.commit(writer);
      }
    };
  }, [cache, canEdit, editor, initialItem, optionsKey, writer]);
  const change = (patch: Partial<typeof draft>) => {
    const next = editor.current?.change(patch);
    if (next !== undefined) {
      setDraft(next);
    }
  };
  // Closing never waits for Planning Center: the unmount save is the one write.
  const close = () => {
    const message = canEdit ? (editor.current?.problem ?? null) : null;
    if (message !== null) {
      toasts.showError(message);
    }
    onClose();
  };
  const remove = () => {
    requestItemRemove(item, () => {
      editor.current?.discard();
      onRemove();
    });
  };
  return (
    <EditorSheet
      title={item.song?.title ?? editorTitle(item)}
      onClose={close}
      actions={
        canEdit
          ? [
              ...(item.song === null
                ? []
                : [
                    {
                      title: "Replace Song",
                      onPress: onReplace,
                      testID: "plan-item-replace",
                    },
                  ]),
              {
                title: "Remove",
                role: "destructive",
                onPress: remove,
                testID: "plan-item-remove",
              },
            ]
          : []
      }
    >
      {item.song === null ? (
        <EditorSection title={item.itemType === "header" ? "Header" : "Title"}>
          <TextInput
            accessibilityLabel="Title"
            testID="plan-item-title-field"
            style={inputStyle}
            editable={canEdit}
            autoFocus={item.title === "New Header" || item.title === "New Item"}
            selectTextOnFocus
            value={draft.title}
            onChangeText={(title) => {
              change({ title });
            }}
            onBlur={() => {
              void persist();
            }}
            returnKeyType="done"
            onSubmitEditing={() => {
              void persist();
            }}
          />
        </EditorSection>
      ) : (
        <>
          <AppText font="rowDetail" color={colors.inkSecondary}>
            {item.song.author}
          </AppText>
          {features.chordCharts ? (
            <EditorSection title="Prepare">
              <PillButton
                title="Read chart"
                kind="secondary"
                testID="plan-item-chart"
                onPress={() => {
                  close();
                  router.push(
                    songPath(
                      songChartHref(
                        item.song?.id ?? "",
                        draft.arrangementId,
                        draft.keyId === "" ? "lyrics" : `key-${draft.keyId}`
                      )
                    )
                  );
                }}
              />
              {draft.arrangementId === "" ? null : (
                <PillButton
                  title="Files and recordings"
                  kind="outline"
                  testID="plan-item-files"
                  onPress={() => {
                    close();
                    router.push(
                      songPath(
                        songFilesHref(item.song?.id ?? "", draft.arrangementId)
                      )
                    );
                  }}
                />
              )}
            </EditorSection>
          ) : null}
          <EditorSection title="Arrangement and key · this plan">
            {options.data === undefined ? (
              <ReadStatus
                error={options.error}
                retry={() => {
                  void options.refetch();
                }}
              />
            ) : (
              <SongFields
                draft={draft}
                options={options.data}
                canEdit={canEdit}
                onChange={(patch) => {
                  change(patch);
                  playHaptic("selection");
                  void persist();
                }}
              />
            )}
          </EditorSection>
        </>
      )}
      {item.itemType === "header" ? null : (
        <EditorSection title="Timing">
          <TextInput
            accessibilityLabel="Length"
            testID="plan-item-length-field"
            style={inputStyle}
            editable={canEdit}
            value={draft.lengthText}
            placeholder="m:ss"
            onChangeText={(lengthText) => {
              change({ lengthText });
            }}
            onBlur={() => {
              void persist();
            }}
            keyboardType="numbers-and-punctuation"
          />
          {error === null ? null : (
            <AppText font="meta" color={colors.destructive}>
              {error}
            </AppText>
          )}
          <Host matchContents={{ vertical: true }} style={{ width: "100%" }}>
            <Picker
              selection={
                draft.servicePosition === "pre" ||
                draft.servicePosition === "post"
                  ? draft.servicePosition
                  : "during"
              }
              onSelectionChange={(servicePosition: PlanItemServicePosition) => {
                if (canEdit) {
                  change({ servicePosition });
                  playHaptic("selection");
                  void persist();
                }
              }}
              modifiers={[pickerStyle("segmented")]}
            >
              <SwiftText modifiers={[tag("pre")]}>Before</SwiftText>
              <SwiftText modifiers={[tag("during")]}>During</SwiftText>
              <SwiftText modifiers={[tag("post")]}>After</SwiftText>
            </Picker>
          </Host>
        </EditorSection>
      )}
      <EditorSection title="Notes">
        <TextInput
          accessibilityLabel="Notes"
          testID="plan-item-notes-field"
          style={[inputStyle, { minHeight: 70 }]}
          editable={canEdit}
          multiline
          value={draft.description}
          placeholder="Who leads, how it starts, where it goes"
          onChangeText={(description) => {
            change({ description });
          }}
          onBlur={() => {
            void persist();
          }}
        />
      </EditorSection>
      {item.song === null ? null : (
        <>
          <PillButton
            title="Song details"
            kind="outline"
            onPress={() => {
              close();
              router.push(songPath(songHref(item.song?.id ?? "")));
            }}
          />
          <PillButton
            title="History"
            kind="outline"
            testID="plan-item-history"
            onPress={() => {
              setHistory(!history);
            }}
          />
          {history ? (
            <SongHistory
              songId={item.song.id}
              ids={ids}
              planDate={planDate}
              previewRows={DETAIL_HISTORY_ROWS}
            />
          ) : null}
        </>
      )}
    </EditorSheet>
  );
};
