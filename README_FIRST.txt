NCAA ROSTER BUILDER - DESKTOP UTILITY V1.1

WHAT IT DOES
Paste an official college football roster URL.
The utility creates CSV and JSON roster files for Special Teams Intelligence.
It attempts to include:
- jersey number
- player name
- position
- height
- weight
- class
- hometown
- previous school
- photo URL
- profile URL
- bio

FIRST-TIME INSTALLATION ON WINDOWS
1. Install Node.js LTS from nodejs.org if it is not already installed.
2. Extract this ZIP.
3. Double-click INSTALL_WINDOWS.bat.
4. Wait for "Installation finished."

EVERYDAY USE
1. Double-click RUN_ROSTER_BUILDER.bat.
2. Paste the official roster URL.
3. Leave "Fetch player bios and missing profile photos" checked.
4. Click Build Roster.
5. Click Save CSV or Save JSON.
6. Import that file into Special Teams Intelligence V8.

OPTIONAL PORTABLE EXE
After installation, double-click BUILD_PORTABLE_EXE.bat.
The finished portable Windows application will appear in the dist folder.

IMPORTANT
Athletics websites can change their HTML. The utility supports common Sidearm roster layouts,
table rosters and JSON-LD fallbacks. Some unusual websites may still require a custom parser.


V1.1 FIX
The Electron preload bridge was changed to CommonJS so the Build Roster,
Save CSV and Save JSON buttons work reliably on Windows.

UPDATING FROM V1.0
1. Extract this ZIP into a new folder.
2. Run INSTALL_WINDOWS.bat.
3. Run RUN_ROSTER_BUILDER.bat.
