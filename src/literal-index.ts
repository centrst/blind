/** One node in an exact UTF-16 literal search, including overlapping matches. */
class Node {
  readonly next = new Map<string, Node>();
  fail: Node = this;
  /** Nearest suffix with a terminal value, without copying its terminals. */
  suffix?: Node;
  readonly values: number[] = [];
}

/**
 * Aho-Corasick search. Build once for all values, then scan each text without
 * visiting absent values. Returns offsets grouped by the original value index.
 * Empty values are ignored. Each call starts at the root, so a match cannot
 * cross text boundaries. Code units keep offsets identical to String.indexOf.
 */
export function literalIndex(values: readonly string[]): (text: string) => Map<number, number[]> {
  const lengths = values.map((value) => value.length);
  const root = new Node();
  values.forEach((value, index) => {
    if (!value) return;
    let node = root;
    for (let i = 0; i < value.length; i++) {
      const ch = value[i] as string;
      let child = node.next.get(ch);
      if (!child) {
        child = new Node();
        child.fail = root;
        node.next.set(ch, child);
      }
      node = child;
    }
    node.values.push(index);
  });

  const queue = [...root.next.values()];
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i] as Node;
    for (const [ch, child] of node.next) {
      let fail = node.fail;
      while (fail !== root && !fail.next.has(ch)) fail = fail.fail;
      child.fail = fail.next.get(ch) ?? root;
      child.suffix = child.fail.values.length ? child.fail : child.fail.suffix;
      queue.push(child);
    }
  }

  return (text) => {
    const found = new Map<number, number[]>();
    let node = root;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i] as string;
      while (node !== root && !node.next.has(ch)) node = node.fail;
      node = node.next.get(ch) ?? root;
      for (let hit: Node | undefined = node; hit; hit = hit.suffix) {
        for (const index of hit.values) {
          let offsets = found.get(index);
          if (!offsets) found.set(index, (offsets = []));
          offsets.push(i + 1 - lengths[index]!);
        }
      }
    }
    return found;
  };
}
