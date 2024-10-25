import {
  Popover,
  PopoverButton,
  PopoverPanel,
  useClose,
} from '@headlessui/react';
import type {SchemaToRow} from '@rocicorp/zero';
import {nanoid} from 'nanoid';
import {useCallback} from 'react';
import {useQuery} from 'zero-react/src/use-query.js';
import addEmojiIcon from '../assets/icons/add-emoji.svg';
import type {Schema} from '../domain/schema.js';
import {useLogin} from '../hooks/use-login.js';
import {useNumericPref} from '../hooks/use-user-pref.js';
import {useZero} from '../hooks/use-zero.js';
import {ButtonWithLoginCheck} from './button-with-login-check.js';
import {EmojiPicker, SKIN_TONE_PREF} from './emoji-picker.js';

type Emoji = SchemaToRow<Schema['tables']['emoji']> & {
  creator: SchemaToRow<Schema['tables']['user']> | undefined;
};

type Props = {
  issueID: string;
  commentID?: string | undefined;
};

export function EmojiPanel({issueID, commentID}: Props) {
  const subjectID = commentID ?? issueID;
  const z = useZero();
  const q = z.query.emoji
    .where('subjectID', subjectID)
    .related('creator', creator => creator.one());

  const emojis: Emoji[] = useQuery(q);

  const skinTone = useNumericPref(SKIN_TONE_PREF, 0);

  const addEmoji = useCallback(
    (unicode: string, annotation: string) => {
      const id = nanoid();
      z.mutate(tx => {
        tx.emoji.create({
          id,
          value: unicode,
          annotation,
          subjectID,
          creatorID: z.userID,
          created: Date.now(),
        });
        tx.issue.update({id: issueID, modified: Date.now()});
      });
    },
    [issueID, subjectID, z],
  );

  const removeEmoji = useCallback(
    (id: string) => {
      z.mutate(tx => {
        tx.emoji.delete({id});
        tx.issue.update({id: issueID, modified: Date.now()});
      });
    },
    [issueID, z],
  );

  // The emojis is an array. We want to group them by value and count them.
  const groups = groupAndSortEmojis(emojis);

  const addOrRemoveEmoji = useCallback(
    (details: {unicode: string; annotation: string}) => {
      const {unicode, annotation} = details;
      const normalizedEmoji = normalizeEmoji(unicode);
      const emojis = groups[normalizedEmoji] ?? [];
      const existingEmojiID = findEmojiForCreator(emojis, z.userID);
      if (existingEmojiID) {
        removeEmoji(existingEmojiID);
      } else {
        addEmoji(unicode, annotation);
      }
    },
    [addEmoji, groups, removeEmoji, z.userID],
  );

  const login = useLogin();
  const loginMessage = 'You need to be logged in to modify emoji reactions.';

  const button = (
    <ButtonWithLoginCheck
      className="add-emoji-button"
      loginMessage={loginMessage}
    >
      <img src={addEmojiIcon} />
    </ButtonWithLoginCheck>
  );

  return (
    <div className="flex gap-2 items-center emoji-reaction-container">
      {Object.entries(groups).map(([normalizedEmoji, emojis]) => (
        <ButtonWithLoginCheck
          className="emoji-pill"
          key={normalizedEmoji}
          title={'TODO: Who reacted with this emoji'}
          loginMessage={loginMessage}
          onAction={() =>
            addOrRemoveEmoji({
              unicode: setSkinTone(normalizedEmoji, skinTone),
              annotation: emojis[0].annotation ?? '',
            })
          }
        >
          {unique(emojis).map(value => (
            <span key={value}>{value}</span>
          ))}
          {' ' + emojis.length}
        </ButtonWithLoginCheck>
      ))}

      {login.loginState !== undefined ? (
        <Popover>
          <PopoverButton as="div">{button}</PopoverButton>
          <PopoverPanel anchor="bottom start" className="popover-panel">
            <PopoverContent onChange={addOrRemoveEmoji} />
          </PopoverPanel>
        </Popover>
      ) : (
        button
      )}
    </div>
  );
}

function PopoverContent({
  onChange,
}: {
  onChange: (emoji: {unicode: string; annotation: string}) => void;
}) {
  const close = useClose();

  const onEmojiChange = useCallback(
    (details: {unicode: string; annotation: string}) => {
      onChange(details);
      close();
    },
    [close, onChange],
  );

  return <EmojiPicker onEmojiChange={onEmojiChange} />;
}

function normalizeEmoji(emoji: string): string {
  // Skin tone modifiers range from U+1F3FB to U+1F3FF
  return emoji.replace(/[\u{1F3FB}-\u{1F3FF}]/gu, '');
}

function groupAndSortEmojis(emojis: Emoji[]): Record<string, Emoji[]> {
  const rv: Record<string, Emoji[]> = {};
  for (const emoji of emojis) {
    const normalizedEmoji = normalizeEmoji(emoji.value);
    if (!rv[normalizedEmoji]) {
      rv[normalizedEmoji] = [];
    }
    rv[normalizedEmoji].push(emoji);
  }

  // Sort the emojis by creation time. Not sure how to sort this with ZQL.
  for (const key in rv) {
    rv[key] = rv[key].sort((a, b) => a.created - b.created);
  }

  return rv;
}

function findEmojiForCreator(
  emojis: Emoji[],
  userID: string,
): string | undefined {
  for (const emoji of emojis) {
    if (emoji.creatorID === userID) {
      return emoji.id;
    }
  }
  return undefined;
}

function unique(emojis: Emoji[]): string[] {
  return [...new Set(emojis.map(emoji => emoji.value))];
}

function setSkinTone(emoji: string, skinTone: number): string {
  const normalizedEmoji = normalizeEmoji(emoji);
  if (skinTone === 0) {
    return normalizedEmoji;
  }

  // Skin tone modifiers range from U+1F3FB to U+1F3FF
  return normalizedEmoji + String.fromCodePoint(0x1f3fa + skinTone);
}
