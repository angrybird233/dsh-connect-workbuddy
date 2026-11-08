/**
 * THE CHOICE OF HEAD LINE (`identityHead`).
 *
 * Two heads exist and both are recognised, because the setting can change
 * between two rescues of the same session:
 *
 *   `neutral`   → `You are a helpful assistant.`   (default)
 *   `workbuddy` → `You are an AI agent running inside WorkBuddy.`
 *
 * What this suite pins:
 *
 *   1. the default is unchanged — an ordinary request still gets the neutral
 *      placeholder, so an upgrade does not silently shift the model's
 *      self-description;
 *   2. `workbuddy` reaches EVERY place a head can appear (the prepend in front of
 *      a refused opening, the forced retry, and the missing-system-prompt
 *      placeholder), so one body never carries two identities;
 *   3. the idempotence guard sees BOTH heads, because otherwise the retry stacks
 *      a second identity line and spends a request on a body nobody measured.
 *
 * @module dsh-connect-workbuddy/tests/identity-head
 */

import { describe, expect, it } from 'vitest'
import {
  WORKBUDDY_FALLBACK_SYSTEM_PROMPT,
  WORKBUDDY_VOICED_SYSTEM_PROMPT,
  forceNeutralHead,
  headForIdentity,
  prepareChatBody,
} from '../src/upstream.ts'

/**
 * A PREFIX-listed opening that the sentence rewrite does not touch. The DSH
 * identity itself is a bad fixture here: since issue #163 it is REWRITTEN, so no
 * head is added for it at all and the assertion would be about the rewrite.
 */
const BANNED_OPENING = "You are Claude Code, Anthropic's official CLI for Claude.\n\nSecond line."

function systemOf(bodyJson: string): string {
  const parsed = JSON.parse(bodyJson) as { messages: { role: string, content: unknown }[] }
  return String(parsed.messages[0]?.content ?? '')
}

function bodyWith(messages: unknown[]): string {
  return JSON.stringify({ model: 'deepseek-v4.1-flash', messages })
}

describe('headForIdentity', () => {
  it('maps the neutral selection (and every absent value) to the placeholder', () => {
    expect(headForIdentity(undefined)).toBe(WORKBUDDY_FALLBACK_SYSTEM_PROMPT)
    expect(headForIdentity('neutral')).toBe(WORKBUDDY_FALLBACK_SYSTEM_PROMPT)
  })

  it('maps workbuddy to the voiced head', () => {
    expect(headForIdentity('workbuddy')).toBe(WORKBUDDY_VOICED_SYSTEM_PROMPT)
  })
})

describe('prepareChatBody honours identityHead', () => {
  it('keeps the neutral placeholder by default', () => {
    const prepared = prepareChatBody(bodyWith([
      { role: 'system', content: BANNED_OPENING },
      { role: 'user', content: 'hello' },
    ]))
    expect(systemOf(prepared).startsWith(`${WORKBUDDY_FALLBACK_SYSTEM_PROMPT}\n\n`)).toBe(true)
    expect(systemOf(prepared)).not.toContain('WorkBuddy')
  })

  it('prepends the voiced head when asked for it', () => {
    const prepared = prepareChatBody(bodyWith([
      { role: 'system', content: BANNED_OPENING },
      { role: 'user', content: 'hello' },
    ]), { identityHead: 'workbuddy' })
    expect(systemOf(prepared).startsWith(`${WORKBUDDY_VOICED_SYSTEM_PROMPT}\n\n`)).toBe(true)
    // The head is an addition, not a replacement: the host's text follows it.
    expect(systemOf(prepared)).toContain('running inside WorkBuddy')
  })

  it('uses the voiced head for the missing-system-prompt placeholder too', () => {
    const prepared = prepareChatBody(bodyWith([
      { role: 'user', content: 'hello' },
    ]), { identityHead: 'workbuddy' })
    expect(systemOf(prepared)).toBe(WORKBUDDY_VOICED_SYSTEM_PROMPT)
  })

  it('leaves the ordinary request untouched under either selection', () => {
    const ordinary = bodyWith([
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'hi' },
    ])
    expect(prepareChatBody(ordinary, { identityHead: 'neutral' })).toBe(prepareChatBody(ordinary))
    expect(prepareChatBody(ordinary, { identityHead: 'workbuddy' })).toBe(prepareChatBody(ordinary))
  })
})

describe('forceNeutralHead honours the head it is given', () => {
  const unmeasured = 'You are some agent nobody has measured.'

  it('defaults to the neutral placeholder', () => {
    const forced = forceNeutralHead(bodyWith([{ role: 'system', content: unmeasured }])) as string
    expect(systemOf(forced)).toBe(`${WORKBUDDY_FALLBACK_SYSTEM_PROMPT}\n\n${unmeasured}`)
  })

  it('uses the voiced head when the caller passes it', () => {
    const forced = forceNeutralHead(
      bodyWith([{ role: 'system', content: unmeasured }]),
      headForIdentity('workbuddy'),
    ) as string
    expect(systemOf(forced)).toBe(`${WORKBUDDY_VOICED_SYSTEM_PROMPT}\n\n${unmeasured}`)
  })

  it('treats the OTHER head as already headed, so a setting change cannot stack two identities', () => {
    // Written under `neutral`, rescued again under `workbuddy`: the second call
    // must change nothing rather than prepend a second identity line.
    const alreadyNeutral = bodyWith([
      { role: 'system', content: `${WORKBUDDY_FALLBACK_SYSTEM_PROMPT}\n\nOrdinary prompt.` },
    ])
    expect(forceNeutralHead(alreadyNeutral, WORKBUDDY_VOICED_SYSTEM_PROMPT)).toBeUndefined()

    const alreadyVoiced = bodyWith([
      { role: 'system', content: `${WORKBUDDY_VOICED_SYSTEM_PROMPT}\n\nOrdinary prompt.` },
    ])
    expect(forceNeutralHead(alreadyVoiced, WORKBUDDY_FALLBACK_SYSTEM_PROMPT)).toBeUndefined()
  })

  it('does not mistake a REWRITTEN host sentence for one of its own heads', () => {
    // The identity rewrite and the voiced head both name WorkBuddy, so they must
    // still be different strings: `startsWithNeutralHead` answers "already
    // headed" on a prefix match, and a rewritten message that reproduced a head
    // verbatim would silently stop getting one — the collision that made the
    // retry send an unheaded body while claiming success.
    const rewritten = 'You are an AI agent running inside the WorkBuddy client.\n\nsure, it is 1+1.'
    expect(rewritten.startsWith(WORKBUDDY_VOICED_SYSTEM_PROMPT)).toBe(false)

    const forced = forceNeutralHead(
      bodyWith([{ role: 'assistant', content: rewritten }]),
      headForIdentity('workbuddy'),
    ) as string
    expect(forced).not.toBeUndefined()
    expect(systemOf(forced)).toBe(`${WORKBUDDY_VOICED_SYSTEM_PROMPT}\n\n${rewritten}`)
  })
})
