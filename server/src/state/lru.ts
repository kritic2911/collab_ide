// ──────────────────────────────────────────────
// LRU Cache — Manual implementation
//
// Data structures:
//   HashMap<K, Node<K,V>>  → O(1) lookup
//   Doubly Linked List     → O(1) move-to-front, O(1) eviction
//
// Sentinel nodes eliminate all null-pointer edge cases.
//
//   [dummy_head] <-> [MRU] <-> ... <-> [LRU] <-> [dummy_tail]
//
// ──────────────────────────────────────────────

/** Internal node in the doubly linked list */
class Node<K, V> {
  key: K;
  value: V;
  prev: Node<K, V> | null = null;
  next: Node<K, V> | null = null;

  constructor(key: K, value: V) {
    this.key = key;
    this.value = value;
  }
}

/**
 * LRU Cache with O(1) get, set, and delete.
 *
 * Every access (get or set) moves the entry to the head (most-recently-used).
 * When capacity is exceeded, the tail (least-recently-used) is evicted.
 */
export class LRUCache<K, V> {
  private readonly map = new Map<K, Node<K, V>>();
  private readonly head: Node<K, V>; // sentinel — never holds real data
  private readonly tail: Node<K, V>; // sentinel — never holds real data

  constructor(private readonly capacity: number) {
    if (capacity < 1) {
      throw new Error('LRU capacity must be >= 1');
    }

    // Create sentinels with dummy values and link them together
    this.head = new Node<K, V>(null as unknown as K, null as unknown as V);
    this.tail = new Node<K, V>(null as unknown as K, null as unknown as V);
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  // ── Public API ──────────────────────────────

  /**
   * Retrieve a value from the cache.
   * Moves the accessed node to head (most-recently-used).
   *
   * @param key {K} The key to look up.
   * @returns {V | null} The associated value, or null on cache miss.
   */
  get(key: K): V | null {
    const node = this.map.get(key);
    if (!node) return null;

    // Move to head — this access makes it "most recently used"
    this.unlink(node);
    this.attachToHead(node);

    return node.value;
  }

  /**
   * Insert or update a key-value pair in the cache.
   * If the key exists, update the value and move to head.
   * If at capacity, evict the least-recently-used entry from the tail.
   *
   * @param key {K} The key to insert or update.
   * @param value {V} The value to store.
   * @returns {void}
   */
  set(key: K, value: V): void {
    const existing = this.map.get(key);

    if (existing) {
      // Key exists — update value and move to head
      existing.value = value;
      this.unlink(existing);
      this.attachToHead(existing);
      return;
    }

    // Key does not exist — check capacity before inserting
    if (this.map.size >= this.capacity) {
      this.evictTail();
    }

    const node = new Node(key, value);
    this.map.set(key, node);
    this.attachToHead(node);
  }

  /**
   * Explicitly remove a key from the cache.
   *
   * @param key {K} The key to remove.
   * @returns {boolean} True if the key was found and deleted, false otherwise.
   */
  delete(key: K): boolean {
    const node = this.map.get(key);
    if (!node) return false;

    this.unlink(node);
    this.map.delete(key);
    return true;
  }

  /**
   * Check if a key exists without updating recency.
   *
   * @param key {K} The key to check for existence.
   * @returns {boolean} True if the key exists, false otherwise.
   */
  has(key: K): boolean {
    return this.map.has(key);
  }

  /**
   * Number of entries currently stored.
   *
   * @returns {number} The count of cached key-value pairs.
   */
  get size(): number {
    return this.map.size;
  }

  // ── Internal linked-list operations ─────────

  /**
   * Detach a node from its current position in the list.
   * The node's prev/next are nulled to avoid dangling pointers.
   */
  private unlink(node: Node<K, V>): void {
    const prev = node.prev!;
    const next = node.next!;
    prev.next = next;
    next.prev = prev;
    node.prev = null;
    node.next = null;
  }

  /**
   * Insert a node immediately after the head sentinel.
   * This makes it the most-recently-used entry.
   */
  private attachToHead(node: Node<K, V>): void {
    const first = this.head.next!;
    this.head.next = node;
    node.prev = this.head;
    node.next = first;
    first.prev = node;
  }

  /**
   * Evict the node immediately before the tail sentinel.
   * This is the least-recently-used entry.
   */
  private evictTail(): void {
    const victim = this.tail.prev!;
    // Sentinel check — if victim IS the head, the list is empty (shouldn't happen)
    if (victim === this.head) return;

    this.unlink(victim);
    this.map.delete(victim.key);
  }
}
