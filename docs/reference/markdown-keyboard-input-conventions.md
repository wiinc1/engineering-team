# Markdown keyboard input conventions

## Purpose

Use these conventions to document keyboard input in Markdown with clear names, accessible prose, and examples that work across platforms.

## Key names

Wrap individual key names in `<kbd>` elements, such as <kbd>Enter</kbd>, <kbd>Esc</kbd>, <kbd>Tab</kbd>, <kbd>Space</kbd>, and <kbd>F5</kbd>.

Use the label printed on the key or the platform's common name. Prefer <kbd>Ctrl</kbd>, <kbd>Alt</kbd>, <kbd>Shift</kbd>, <kbd>Cmd</kbd>, <kbd>Option</kbd>, and <kbd>Windows</kbd> for modifier keys.

Write letter keys as uppercase single letters, such as <kbd>K</kbd>, even when the user does not need to hold <kbd>Shift</kbd>.

## Shortcuts

Use plus signs between keys that are pressed at the same time.

Examples:

- Press <kbd>Ctrl</kbd>+<kbd>K</kbd> to open search.
- Press <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> to open the command palette.
- Press <kbd>Alt</kbd>+<kbd>F4</kbd> to close the active window.

Do not put spaces around plus signs inside a shortcut. The compact form keeps shortcuts scannable and avoids implying separate actions.

## Sequences

Use words such as "then" or numbered steps for keys pressed in sequence.

Examples:

- Press <kbd>G</kbd> then <kbd>I</kbd> to open the inbox.
- Press <kbd>Esc</kbd>, then press <kbd>Enter</kbd> to confirm the dialog.

Do not use plus signs for sequences. A plus sign means the keys are held together.

## Platform differences

Name platform-specific shortcuts explicitly when behavior differs.

Examples:

- macOS: Press <kbd>Cmd</kbd>+<kbd>K</kbd>.
- Windows and Linux: Press <kbd>Ctrl</kbd>+<kbd>K</kbd>.

When the action is the same on every supported platform, document one shortcut instead of listing platforms.

## Accessible prose

Introduce shortcuts with the action they perform. Do not rely on the shortcut alone to explain the command.

Prefer "Press <kbd>Enter</kbd> to save the form" over "Hit <kbd>Enter</kbd>" or "<kbd>Enter</kbd> saves." Clear verbs help screen reader users and make translated text easier to maintain.

Avoid directional language that assumes a keyboard layout when a named key is clearer. Use "Press <kbd>Tab</kbd> to move focus to the next field" instead of "Move right to the next field."

## Examples

Use:

- Press <kbd>Ctrl</kbd>+<kbd>S</kbd> to save changes.
- Press <kbd>Cmd</kbd>+<kbd>/</kbd> to toggle comments on macOS.
- Press <kbd>Esc</kbd> to close the menu.
- Press <kbd>Tab</kbd> then <kbd>Enter</kbd> to select the highlighted item.

Avoid:

- Press `Ctrl+S` to save changes.
- Press CTRL + S to save changes.
- Press <kbd>Ctrl + S</kbd> to save changes.
- Press <kbd>G</kbd>+<kbd>I</kbd> to open the inbox when the keys are sequential.

## Validation guidance

Review keyboard input documentation for these checks:

- Every key or shortcut uses `<kbd>` markup.
- Simultaneous shortcuts use plus signs between separate `<kbd>` elements.
- Sequential key presses use prose instead of plus signs.
- Platform-specific shortcuts name the platform before the shortcut.
- The surrounding sentence states the action and does not depend on visual position alone.

## Rollback

Revert the documentation commit to remove these conventions.
