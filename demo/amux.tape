# amux demo — a VHS tape (https://github.com/charmbracelet/vhs).
# Render:  vhs demo/amux.tape   (needs vhs + ttyd + ffmpeg installed)
# Output is written to assets/demo.gif, which the README embeds.

Output assets/demo.gif

Set Shell "bash"
Set FontSize 18
Set Width 1200
Set Height 720
Set Padding 24
Set Theme "Github Dark"
Set TypingSpeed 60ms

# A throwaway repo so the demo is self-contained.
Hide
Type "cd $(mktemp -d) && git init -q -b main && git commit -q --allow-empty -m init && clear"
Enter
Show

Type "amux new fix-auth --agent shell"
Enter
Sleep 1200ms

Type "amux new add-tests --agent shell"
Enter
Sleep 1200ms

Type "amux ls"
Enter
Sleep 2s

Type "amux broadcast --message 'echo running tests'"
Enter
Sleep 1500ms

Type "amux conflicts"
Enter
Sleep 2500ms

# Cleanup (hidden).
Hide
Type "amux kill fix-auth --rm-worktree && amux kill add-tests --rm-worktree"
Enter
Show
Sleep 500ms
