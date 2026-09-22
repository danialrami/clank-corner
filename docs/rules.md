# Rules — `corner-1`

## State and timing

Each seat (`A`, `B`) starts with **12 HP** and **3 energy**. Energy is capped at **6**. A bout has at most **8 simultaneous turns** and one leg (`leg: 1`). Turn numbers begin at 1 and advance only after a pair resolves.

Both actions are checked and sealed against the same start-of-turn state. The referee then:

1. verifies both moves are affordable;
2. deducts both costs;
3. computes both damage amounts;
4. applies damage simultaneously; and
5. applies recharge gains, capped at 6.

HP and energy never go below zero. A fighter's move is not canceled merely because that fighter reaches zero HP in the same exchange.

## Moves

| Move | Cost | Effect |
| --- | ---: | --- |
| `jab` | 1 | Deals 2 base damage. |
| `heavy` | 3 | Deals 5 base damage. |
| `guard` | 0 | Reduces incoming `jab`/`heavy` damage by 3, floor 0. Does not reduce `feint`. |
| `counter` | 2 | Against `jab`/`heavy`, cancels that attack and deals 4 to its attacker. Against anything else, deals 0 and does not block. |
| `recharge` | 0 | Restores 2 energy after damage, capped at 6. Deals 0. |
| `feint` | 2 | Deals 2 damage, ignoring both `guard` and `counter`. |

The only action object is exactly one of:

```json
{"type":"jab"}
```

where `type` is `jab`, `heavy`, `guard`, `counter`, `recharge`, or `feint`. No other object keys are legal. Legal-action lists include only currently affordable actions.

## Result

- When one fighter reaches zero HP, the surviving seat wins by `knockout`.
- Simultaneous zero HP is a `double-ko` draw.
- After turn 8, higher HP wins by `points`.
- Equal HP after turn 8 is a `draw-at-limit`; energy is never a tiebreaker.
- A deadline abort is `timeout-A`, `timeout-B`, or `timeout-both`, naming missing seats. An abort has no winner.

Provider, client, transport, and referee errors are never tactical wins.

## Practice policies

`aggressive`, `cautious`, and `reactive` are deterministic scripted styles. They receive only their own observation and legal actions. They do not inspect an opponent's sealed move, invoke a model, or consume a coaching note. The policies preserve seat symmetry; the same observation yields the same choice independent of seat letter.
