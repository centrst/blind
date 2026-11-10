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
  const root = automaton(values);
  return (text) => {
    const found = new Map<number, number[]>();
    let node = root;
    for (let i = 0; i < text.length; i++) {
      node = step(root, node, text[i] as string);
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

/**
 * Which of `values` occur in a text, without their offsets. Each terminal node's
 * suffix chain is walked once per text, so the work is the text's length plus
 * the number of values, and the memory the number of values, however often a
 * value repeats.
 */
export function literalPresence(values: readonly string[]): (text: string) => Set<number> {
  const root = automaton(values);
  return (text) => {
    const found = new Set<number>();
    const seen = new Set<Node>();
    let node = root;
    for (let i = 0; i < text.length; i++) {
      node = step(root, node, text[i] as string);
      // A node already seen had its whole suffix chain added then.
      for (let hit = node.values.length ? node : node.suffix; hit && !seen.has(hit); hit = hit.suffix) {
        seen.add(hit);
        for (const index of hit.values) found.add(index);
      }
    }
    return found;
  };
}

/** The node after `node` reads `ch`. */
function step(root: Node, node: Node, ch: string): Node {
  while (node !== root && !node.next.has(ch)) node = node.fail;
  return node.next.get(ch) ?? root;
}

/** The trie of `values` with its failure and suffix links. */
function automaton(values: readonly string[]): Node {
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
  return root;
}
