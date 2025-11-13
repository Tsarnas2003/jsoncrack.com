import React from "react";
import type { ModalProps } from "@mantine/core";
import { Modal, Stack, Text, ScrollArea, Flex, CloseButton, Button, Textarea } from "@mantine/core";
import { CodeHighlight } from "@mantine/code-highlight";
import type { NodeData } from "../../../types/graph";
import useGraph from "../../editor/views/GraphView/stores/useGraph";
import useJson from "../../../store/useJson";
import useFile from "../../../store/useFile";
import { useState, useEffect, useRef } from "react";

// return object from json removing array and object fields
const normalizeNodeData = (nodeRows: NodeData["text"]) => {
  if (!nodeRows || nodeRows.length === 0) return "{}";
  if (nodeRows.length === 1 && !nodeRows[0].key) return `${nodeRows[0].value}`;

  const obj = {};
  nodeRows?.forEach(row => {
    if (row.type !== "array" && row.type !== "object") {
      if (row.key) obj[row.key] = row.value;
    }
  });
  return JSON.stringify(obj, null, 2);
};

// return json path in the format $["customer"]
const jsonPathToString = (path?: NodeData["path"]) => {
  if (!path || path.length === 0) return "$";
  const segments = path.map(seg => (typeof seg === "number" ? seg : `"${seg}"`));
  return `$[${segments.join("][")}]`;
};

export const NodeModal = ({ opened, onClose }: ModalProps) => {
  const nodeData = useGraph(state => state.selectedNode);
  const setJson = useJson(state => state.setJson);

  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  const applyParsed = (parsed: any) => {
    // Build root object by applying parsed value at node path to a copy of stored JSON
    const current = JSON.parse(useJson.getState().getJson());

    // if no path (root), return the parsed root
    if (!nodeData?.path || nodeData.path.length === 0) {
      return JSON.stringify(parsed, null, 2);
    }

    const root = Array.isArray(current) ? [...current] : { ...current };

    // helper to set value at path
    const setAtPath = (obj: any, path: any[], value: any) => {
      let parent = obj;
      for (let i = 0; i < path.length - 1; i++) {
        const seg = path[i];
        if (typeof seg === "number") {
          if (!Array.isArray(parent[seg])) parent[seg] = [];
          parent = parent[seg];
        } else {
          if (parent[seg] === undefined || parent[seg] === null) parent[seg] = {};
          parent = parent[seg];
        }
      }
      const last = path[path.length - 1];
      // If existing value is an object and new value is an object, merge shallowly
      const existing = parent[last as any];
      const isObj = (v: any) => v && typeof v === "object" && !Array.isArray(v);
      if (isObj(existing) && isObj(value)) {
        parent[last as any] = { ...existing, ...value };
      } else {
        parent[last as any] = value;
      }
    };

    setAtPath(root, nodeData.path as any[], parsed);

    return JSON.stringify(root, null, 2);
  };

  // NOTE: we do not update preview or editor during typing.
  // applyParsed returns the JSON string for a potential persisted change.

  // persist parsed value to app json (called on Save)
  const persistParsed = (parsed: any) => {
    const jsonStr = applyParsed(parsed);
    if (jsonStr) {
      setJson(jsonStr);
      // after persisting, refresh selected node in graph store so modal content updates
      try {
        const updated = useGraph.getState().nodes.find(n => JSON.stringify(n.path) === JSON.stringify(nodeData?.path));
        if (updated) useGraph.getState().setSelectedNode(updated);
      } catch (e) {
        // ignore
      }
      // ensure the main editor reflects the persisted content and mark saved
      try {
        useFile.setState({ contents: jsonStr, hasChanges: false });
      } catch (e) {
        // ignore
      }
    }
  };

  useEffect(() => {
    // reset local edit state when node changes or modal closes
    setIsEditing(false);
    setError(null);
    setEditText(normalizeNodeData(nodeData?.text ?? []));
  }, [nodeData, opened]);

  return (
    <Modal size="auto" opened={opened} onClose={onClose} centered withCloseButton={false}>
      <Stack pb="sm" gap="sm">
        <Stack gap="xs">
          <Flex justify="space-between" align="center">
            <Text fz="xs" fw={500}>
              Content
            </Text>
            <Flex gap="xs" align="center">
              {isEditing ? (
                <>
                  <Button size="xs" color="green" onClick={async () => {
                    setError(null);
                    try {
                      const parsed = JSON.parse(editText);
                      persistParsed(parsed);
                      setIsEditing(false);
                    } catch (err: any) {
                      setError(err?.message || "Invalid JSON");
                    }
                  }}>
                    Save
                  </Button>
                  <Button size="xs" color="gray" onClick={() => {
                    // cancel any pending debounce
                    if (debounceRef.current) window.clearTimeout(debounceRef.current);
                    debounceRef.current = null;
                    // Do not change graph/editor on cancel. Just discard local edits.
                    setIsEditing(false);
                    setError(null);
                    setEditText(normalizeNodeData(nodeData?.text ?? []));
                  }}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button size="xs" onClick={() => setIsEditing(true)}>Edit</Button>
                  <CloseButton onClick={onClose} />
                </>
              )}
            </Flex>
          </Flex>
          <ScrollArea.Autosize mah={250} maw={600}>
            {isEditing ? (
              <Textarea
                minRows={6}
                value={editText}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setEditText(v);
                  setError(null);

                  // debounce validation only (do not update preview/editor)
                  if (debounceRef.current) window.clearTimeout(debounceRef.current);
                  debounceRef.current = window.setTimeout(() => {
                    try {
                      JSON.parse(v);
                      setError(null);
                    } catch (err: any) {
                      setError(err?.message || "Invalid JSON");
                    }
                  }, 700) as unknown as number;
                }}
                styles={{ input: { fontFamily: "monospace" } }}
              />
            ) : (
              <CodeHighlight
                code={normalizeNodeData(nodeData?.text ?? [])}
                miw={350}
                maw={600}
                language="json"
                withCopyButton
              />
            )}
            {error ? <Text color="red" fz="xs">{error}</Text> : null}
          </ScrollArea.Autosize>
        </Stack>
        <Text fz="xs" fw={500}>
          JSON Path
        </Text>
        <ScrollArea.Autosize maw={600}>
          <CodeHighlight
            code={jsonPathToString(nodeData?.path)}
            miw={350}
            mah={250}
            language="json"
            copyLabel="Copy to clipboard"
            copiedLabel="Copied to clipboard"
            withCopyButton
          />
        </ScrollArea.Autosize>
      </Stack>
    </Modal>
  );
};
