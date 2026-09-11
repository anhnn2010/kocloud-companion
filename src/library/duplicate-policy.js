export const DUPLICATE_KEEP_POLICIES = Object.freeze({
  SHORTEST_PATH: "shortest-path",
  OLDEST: "oldest",
  NEWEST: "newest",
});

function pathDepth(path) {
  return String(path || "")
    .split("/")
    .filter(Boolean).length;
}

function timestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function comparePath(left, right) {
  const leftPath = String(left?.path || "");
  const rightPath = String(right?.path || "");
  const leftDepth = pathDepth(leftPath);
  const rightDepth = pathDepth(rightPath);

  if (leftDepth !== rightDepth) {
    return leftDepth - rightDepth;
  }
  if (leftPath.length !== rightPath.length) {
    return leftPath.length - rightPath.length;
  }
  return leftPath.localeCompare(rightPath, undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

function compareOldest(left, right) {
  const diff = timestamp(left?.modifiedTime) - timestamp(right?.modifiedTime);
  return diff || comparePath(left, right);
}

function compareNewest(left, right) {
  const diff = timestamp(right?.modifiedTime) - timestamp(left?.modifiedTime);
  return diff || comparePath(left, right);
}

export function chooseDuplicateKeep(
  group,
  policy = DUPLICATE_KEEP_POLICIES.SHORTEST_PATH
) {
  const files = [...(group?.files || [])];
  if (files.length === 0) {
    return null;
  }

  switch (policy) {
    case DUPLICATE_KEEP_POLICIES.OLDEST:
      files.sort(compareOldest);
      break;
    case DUPLICATE_KEEP_POLICIES.NEWEST:
      files.sort(compareNewest);
      break;
    case DUPLICATE_KEEP_POLICIES.SHORTEST_PATH:
    default:
      files.sort((left, right) => {
        const diff = comparePath(left, right);
        return diff || compareOldest(left, right);
      });
      break;
  }

  return files[0]?.id || null;
}

export function paginateDuplicateGroups(groups, pageIndex, pageSize = 20) {
  const safeSize = Math.max(1, Math.floor(Number(pageSize) || 20));
  const totalItems = Array.isArray(groups) ? groups.length : 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / safeSize));
  const safePage = Math.min(
    Math.max(0, Math.floor(Number(pageIndex) || 0)),
    totalPages - 1
  );
  const start = safePage * safeSize;

  return {
    pageIndex: safePage,
    pageSize: safeSize,
    totalItems,
    totalPages,
    start,
    end: Math.min(totalItems, start + safeSize),
    items: (groups || []).slice(start, start + safeSize),
  };
}
