import * as Y from 'yjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { isOnlyAnswers } from '@shared/answers';

/**
 * The Answer role's rule, as the room applies it: a change from someone who answers is
 * read before it is applied, and only words typed in placeholders get through.
 */

let room: Y.Doc;
let student: Y.Doc;

function element(fields: Record<string, unknown>, text?: string) {
  const map = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(fields)) map.set(key, value);
  if (text !== undefined) map.set('text', new Y.Text(text));
  return map;
}

beforeEach(() => {
  room = new Y.Doc();
  const elements = room.getMap('elements');
  elements.set(
    'answer',
    element({ id: 'answer', type: 'text', x: 0, y: 0, h: 40, placeholder: 'Your name' }, ''),
  );
  elements.set(
    'filled',
    element({ id: 'filled', type: 'text', x: 0, y: 60, h: 40, placeholder: '' }, 'Hello'),
  );
  elements.set(
    'words',
    element({ id: 'words', type: 'text', x: 0, y: 120, h: 40 }, 'The question'),
  );
  elements.set('box', element({ id: 'box', type: 'rect', x: 200, y: 0, h: 40 }));
  room.getMap('meta').set('title', 'Quiz');

  student = new Y.Doc();
  Y.applyUpdate(student, Y.encodeStateAsUpdate(room));
});

/** What the student's page would send: everything the room does not have yet. */
const change = () => Y.encodeStateAsUpdate(student, Y.encodeStateVector(room));
const map = (id: string) => student.getMap('elements').get(id) as Y.Map<unknown>;
const words = (id: string) => map(id).get('text') as Y.Text;

describe('someone who answers', () => {
  it('is judged rightly by a room that has just rebuilt its board from storage', () => {
    // A waking room applies its stored changes to a new document and has asked it for
    // nothing yet: the first answer used to be refused.
    const woken = new Y.Doc();
    Y.applyUpdate(woken, Y.encodeStateAsUpdate(room));
    words('answer').insert(0, 'A');
    expect(isOnlyAnswers(woken, change())).toBe(true);
  });

  it('may type into a placeholder: at the start, along it, and several letters at once', () => {
    words('answer').insert(0, 'A');
    expect(isOnlyAnswers(room, change())).toBe(true);
    Y.applyUpdate(room, change());
    student.transact(() => {
      words('answer').insert(1, 'da');
      words('answer').insert(3, 'm');
    });
    expect(isOnlyAnswers(room, change())).toBe(true);
  });

  it('may delete and format words in a placeholder, and let the box grow', () => {
    student.transact(() => {
      words('filled').delete(0, 2);
      words('filled').format(0, 2, { bold: true });
      map('filled').set('h', 80);
    });
    expect(isOnlyAnswers(room, change())).toBe(true);
  });

  it('may send again what the room already has, as a page does when it reconnects', () => {
    words('answer').insert(0, 'Hi');
    Y.applyUpdate(room, change());
    expect(isOnlyAnswers(room, Y.encodeStateAsUpdate(student))).toBe(true);
  });

  it('may not move, resize sideways or re-word the hint of a placeholder', () => {
    map('answer').set('x', 500);
    expect(isOnlyAnswers(room, change())).toBe(false);
  });

  it('may not change the hint', () => {
    map('answer').set('placeholder', 'Anything');
    expect(isOnlyAnswers(room, change())).toBe(false);
  });

  it('may not type in an ordinary text box, nor delete its words', () => {
    words('words').insert(0, 'Not ');
    expect(isOnlyAnswers(room, change())).toBe(false);
    student = new Y.Doc();
    Y.applyUpdate(student, Y.encodeStateAsUpdate(room));
    words('words').delete(0, 4);
    expect(isOnlyAnswers(room, change())).toBe(false);
  });

  it('may not add, remove or change anything else', () => {
    student.getMap('elements').set('new', element({ id: 'new', type: 'rect' }));
    expect(isOnlyAnswers(room, change())).toBe(false);

    student = new Y.Doc();
    Y.applyUpdate(student, Y.encodeStateAsUpdate(room));
    student.getMap('elements').delete('box');
    expect(isOnlyAnswers(room, change())).toBe(false);

    student = new Y.Doc();
    Y.applyUpdate(student, Y.encodeStateAsUpdate(room));
    student.getMap('meta').set('effect', { kind: 'confetti' });
    expect(isOnlyAnswers(room, change())).toBe(false);
  });

  it('cannot slip a forbidden change in with an allowed one', () => {
    student.transact(() => {
      words('answer').insert(0, 'fine');
      map('box').set('x', 0);
    });
    expect(isOnlyAnswers(room, change())).toBe(false);
  });

  it('cannot hide a box in its height', () => {
    map('answer').set('h', 'tall');
    expect(isOnlyAnswers(room, change())).toBe(false);
  });

  it('is refused for something that is not a change at all', () => {
    expect(isOnlyAnswers(room, new Uint8Array([1, 2, 3]))).toBe(false);
  });
});
