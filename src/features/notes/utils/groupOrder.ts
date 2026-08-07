import type { Group } from "../types";

export const moveGroupToTarget = (
  groups: Group[],
  sourceId: string,
  targetId: string
) => {
  const sourceIndex = groups.findIndex((group) => group.id === sourceId);
  const targetIndex = groups.findIndex((group) => group.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return groups;
  }

  const reordered = [...groups];
  const [source] = reordered.splice(sourceIndex, 1);
  reordered.splice(targetIndex, 0, source);

  return reordered.map((group, index) => ({
    ...group,
    displayOrder: index,
  }));
};
