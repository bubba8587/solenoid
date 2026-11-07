Solenoid fast-render preview (branch blitz-gpui)

Two native viewers of real Solenoid canvases, captured from the app (scenes/):

  solenoid-blitz   the app's own HTML and CSS, laid out by Blitz, drawn by Vello on the GPU.
                   Pan: drag. Zoom: wheel. The title bar shows fps and the CPU cost of a frame.
  solenoid-gpui    the same canvases as GPUI draws them (Zed's UI framework). Drag a card to move it.

Run (from this folder):

  Linux / macOS:  ./run-blitz.sh zz-scratch-new-nodes 4      (scene, then tiles: 4 = 4x4 copies, ~3,900 cards)
                  ./run-gpui.sh personal-finance
  Windows:        run-blitz.bat zz-scratch-new-nodes 4
                  run-gpui.bat personal-finance

Any scene in scenes/ works. Tiles stamp the graph N x N to load the GPU with thousands of real cards.
Add --animate to the blitz command line to pan continuously while you read the frame rate.
Each scene folder holds chromium.png: the app itself at the starting camera, to compare against.

Linux needs Vulkan drivers and libxkbcommon-x11 (most desktops have them).
macOS builds are unsigned: right-click > Open the first time, or run  xattr -dr com.apple.quarantine .
