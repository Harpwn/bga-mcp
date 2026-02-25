// =============================================================================
// BGA MCP Server — central configuration
//
// Everything a user is likely to want to tweak lives here.
// =============================================================================

// ---------------------------------------------------------------------------
// Environment / paths
// ---------------------------------------------------------------------------

/**
 * Root directory that contains your BGA game project folder(s).
 * Set via the BGA_WORKSPACE_PATH environment variable (configured automatically
 * in .vscode/mcp.json via "${workspaceFolder}").
 */
export const WORKSPACE_PATH = process.env.BGA_WORKSPACE_PATH as
  | string
  | undefined;

// ---------------------------------------------------------------------------
// BGA Wiki API
// ---------------------------------------------------------------------------

/** Base URL for the BGA Studio MediaWiki API. */
export const BGA_WIKI_API = "https://en.doc.boardgamearena.com/api.php";

/** Timeout (ms) for wiki fetch requests. */
export const BGA_WIKI_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Documentation page catalog
// ---------------------------------------------------------------------------

export interface DocPage {
  alias: string; // short key used as the tool argument
  wikiPage: string; // exact MediaWiki page title
  description: string; // one-line summary shown in the catalog
  category: string;
}

/**
 * Curated list of BGA Studio wiki pages exposed by bga_list_doc_pages /
 * bga_get_doc_page.  Add, remove, or reorder entries here to change what
 * the AI can look up.
 */
export const BGA_DOC_PAGES: DocPage[] = [
  // ── Game logic (Server side) ──────────────────────────────────────────────
  {
    alias: "main_game_logic",
    wikiPage: "Main_game_logic:_Game.php",
    description:
      "Game.php — central server class covering: setupNewGame, getAllDatas, getGameProgression, " +
      "DB helpers (getCollectionFromDB, getObjectFromDB, etc.), bga->globals, bga->notify, " +
      "game state / active-player APIs, autowired act* actions with typed params, scoring & tie-breakers, " +
      "undo (undoSavepoint / undoRestorePoint), zombie handling, UserException, and legacy/tournament APIs",
    category: "Game Logic",
  },
  {
    alias: "game_states",
    wikiPage: "Your_game_state_machine:_states.inc.php",
    description:
      "(Deprecated — prefer State classes) states.inc.php — legacy PHP-array state machine using GameStateBuilder. " +
      "Covers state types (ACTIVE_PLAYER, MULTIPLE_ACTIVE_PLAYER, PRIVATE, GAME), transitions, " +
      "possibleactions, args (including _private), private parallel states, and design patterns",
    category: "Game Logic",
  },
  {
    alias: "state_classes",
    wikiPage: "State_classes:_State_directory",
    description:
      "modules/php/States/ — modern recommended approach: one PHP class per state extending GameState. " +
      "Each class defines getArgs(), onEnteringState(), #[PossibleAction] act* methods, and zombie(). " +
      "setupNewGame() returns the first state class. Supports private parallel states and named-constant IDs. " +
      "Replaces states.inc.php; includes migration guide from legacy format",
    category: "Game Logic",
  },
  {
    alias: "player_actions",
    wikiPage: "Players_actions:_yourgamename.action.php",
    description:
      "(Deprecated — use autowired act* methods instead) action.php — legacy AJAX-to-PHP bridge. " +
      "Documents getArg() argument types (AT_int, AT_alphanum, AT_json, AT_enum, etc.), " +
      "setAjaxMode(), ajaxResponse(), and argument validation best practices",
    category: "Game Logic",
  },
  {
    alias: "notifications",
    wikiPage: "Main_game_logic:_Game.php",
    description:
      "BGA notifications system (documented in Game.php wiki): bga->notify->all() and bga->notify->player() " +
      "send typed notifications to JS handlers; covers clienttranslate() message format, notification args, " +
      "_private data per player, preserve flag for history replays, recursive notifications, " +
      "player_name colouring convention, and addDecorator() for shared arg enrichment",
    category: "Game Logic",
  },
  {
    alias: "database",
    wikiPage: "Game_database_model:_dbmodel.sql",
    description:
      "dbmodel.sql — MySQL InnoDB schema file executed at table creation. " +
      "Covers CREATE TABLE rules (IF NOT EXISTS, primary keys, charset), extending the player table, " +
      "avoiding implicit-commit operations, post-release migration via upgradeTableDb(), " +
      "AUTO_INCREMENT caveats, and the 64 MB database size limit",
    category: "Game Logic",
  },
  {
    alias: "material",
    wikiPage: "Game_material_description:_material.inc.php",
    description:
      "material.inc.php — static game data file for card types, token definitions, PHP constants, and tooltips. " +
      "Loaded by the Game constructor; variables are accessible throughout game.php and view.php. " +
      "Can be moved to modules/php or split across files; supports runtime adjustment via initTable() for expansion variants",
    category: "Game Logic",
  },
  {
    alias: "stats",
    wikiPage: "Game_statistics:_stats.json",
    description:
      "stats.json — defines int/float/bool table and player statistics shown at game end. " +
      "IDs must be ≥ 10; managed via bga->tableStats and bga->playerStats (init/set/inc/get/incAll). " +
      "Supports labeled values (value_labels), limited-access (developer-only) stats, " +
      "and automatic translation of stat names. Reload config in Studio after any changes",
    category: "Game Logic",
  },

  // ── Game interface (Client side) ─────────────────────────────────────────
  {
    alias: "game_interface",
    wikiPage: "Game_interface_logic:_Game.js",
    description:
      "Game.js (modules/js/Game.js) — main client-side JS file for the game interface. " +
      "Key lifecycle methods: constructor (register JS State classes), setup(gamedatas) (build initial DOM), " +
      "onEnteringState/onLeavingState/onUpdateActionButtons (optional — not needed with JS State classes). " +
      "Modern API via bga sub-components: bga.actions.performAction(action, args) to call server, " +
      "bga.notifications.setupPromiseNotifications() for async notification handlers (notif_* methods), " +
      "bga.states.register/setClientState/restoreServerGameState for JS State classes and client states, " +
      "bga.statusBar.addActionButton/setTitle, bga.dialogs.confirmation/multipleChoice/showMessage, " +
      "bga.gameui.slideToObject/fadeOutAndDestroy/rotateTo animations, bga.players.isCurrentPlayerActive(), " +
      "bga.playerPanels.getElement/getScoreCounter, bga.images.dontPreloadImage/preloadImage, " +
      "bga.sounds.load/play, bga.userPreferences.get/set/onChange. " +
      "DOM helpers: $(id), gameArea.getElement(), placeOnObject, attachToNewParent, format_block, format_string. " +
      "Notifications: setSynchronous/setSynchronousDuration for timed handlers, setIgnoreNotificationCheck. " +
      "Misc: addTooltip/addTooltipHtml, addLastTurnBanner/addWinConditionBanner, displayScoring, showBubble, " +
      "bgaAnimationsActive(), g_replayFrom/g_archive_mode globals, onScreenWidthChange override",
    category: "Game Interface",
  },
  {
    alias: "game_layout",
    wikiPage:
      "Game_layout:_view_and_template:_yourgamename.view.php_and_yourgamename_yourgamename.tpl",
    description:
      "DEPRECATED — prefer generating templates from JS (see Reversi tutorial). " +
      "yourgamename.view.php + yourgamename_yourgamename.tpl together define the server-rendered HTML base layout. " +
      ".tpl file: raw HTML with {VARIABLE} placeholders and <!-- BEGIN/END blockname --> repeating blocks; " +
      "JavaScript templates (var jstpl_* = '...') defined here for dynamic JS insertion via format_block(). " +
      ".view.php: assigns $this->tpl['KEY'] = self::_('translated') or self::raw('<html>'); " +
      "calls begin_block/insert_block for repeating content, reset_subblocks for nested block resets. " +
      "Use for: overall layout, board, fixed elements rendered once at page load. " +
      "Do NOT use for: game elements that come/go, or hidden elements. " +
      "Access game data from view.php: getCurrentPlayerId(), $this->game (full game object), isSpectator(). " +
      "Variable warnings: avoid {id}, {ID}, and any {LB_*} names",
    category: "Game Interface",
  },
  {
    alias: "game_css",
    wikiPage: "Game_interface_stylesheet:_yourgamename.css",
    description:
      "yourgamename.css — single CSS file for the entire game interface (no additional CSS imports allowed; compressed on production). " +
      "Primary uses: (1) overall layout of board, panels, and decks; " +
      "(2) CSS sprites — gather images into sprite sheets, use background-image + background-position to display them " +
      "(e.g. .black_token { background-position: -20px 0px; }); " +
      "(3) dynamic class manipulation from JS (classList.add/remove/toggle). " +
      "spectatorMode class: added to root HTML when user is a spectator — use to hide player-specific elements. " +
      "Dark mode: target html[data-theme='dark'] (preferred over prefers-color-scheme media query). " +
      "z-index warning: BGA dialogs use 950; keep game z-indexes below 900 (1 is usually enough). " +
      "drop-shadow warning: causes Safari performance issues; use box-shadow or dj_safari class to disable. " +
      "background-position warning: mixing pixel and percentage units causes Safari rounding misalignment — use consistent units and specify background-size",
    category: "Game Interface",
  },
  {
    alias: "game_art",
    wikiPage: "Game_art:_img_directory",
    description:
      "img/ directory — stores all game images. Root-level images are preloaded by default on page load (keep small); " +
      "images in subdirectories are NOT preloaded. " +
      "Control loading: bga.images.dontPreloadImage('cards.png') to skip, preloadImage() to force-load subdirectory images. " +
      "Formats: jpg (non-transparent, boards/cards — smaller files), png (transparency — tokens/meeples), gif (animated), svg (icons). " +
      "Auto-converted to webp on deployment; capitalize extension (.Png/.Jpg) to bypass webp conversion if lossy conversion is a problem. " +
      "CSS sprites: combine multiple images into one file (max 4096×4096 px — Android limit); use background-size + background-position. " +
      "Use background-size for browser-zoom support (supply higher-res images than needed). " +
      "Naming: no spaces or parentheses in filenames. " +
      "Shrink tools: pngquant (offline), tinypng/squoosh (online), ImageMagick (command-line). " +
      "Metadata images (box art, banners, titles) are managed separately via the Game Metadata Manager — not stored in img/. " +
      "Publisher asset requests: square card/board PDFs (no bleeds), non-square tokens as PNG, English/no-text versions for translated text overlay",
    category: "Game Interface",
  },
  {
    alias: "mobile",
    wikiPage: "Your_game_mobile_version",
    description:
      "Mobile and tablet support guide. Primary setting: game_interface_width in gameinfos.inc.php — " +
      "set 'min' to declare minimum interface width (default 740px, minimum 320px; recommend ≥490 to keep 2-column player panels). " +
      "autoscale option: true (default) = CSS zoom on panels+title+gameArea; false = CSS zoom excludes gameArea; 'viewport' = native viewport. " +
      "CSS classes added to #ebd-body: 'mobile_version' (panels at top) / 'desktop_version' (panels on right); " +
      "'touch-device' / 'notouch-device' for touchscreen detection. " +
      "Touchscreen compatibility: :hover won't fire — prefix hover rules with .notouch-device; " +
      "tooltips unreliable on mobile (use click handler or dedicated area instead); " +
      "replace onmouseover with pointer events; drag-and-drop: use Pointer Events API or HTML Drag and Drop API, " +
      "add touch-action:none to draggable elements to prevent scroll interference. " +
      "Viewport meta tag: BGA uses non-standard CSS zoom (legacy); override by setting min in gameinfos + " +
      "overriding onScreenWidthChange() to set this.default_viewport and remove zoom property. " +
      "Landscape viewport override requires undocumented framework functions — not recommended",
    category: "Game Interface",
  },

  // ── Other file references ─────────────────────────────────────────────────
  {
    alias: "game_file_reference",
    wikiPage: "Studio_file_reference",
    description:
      "Quick reference for every file in a BGA game project, with reload requirements. " +
      "img/ — game art (Ctrl+F5 to clear cache after changes). " +
      "gameinfos.inc.php — meta-info (requires Control Panel 'Reload game informations'). " +
      "dbmodel.sql — DB schema (requires game restart; migration needed if in production). " +
      "gameoptions.json / gamepreferences.json — options/prefs (requires Control Panel reload). " +
      ".css — stylesheet (Ctrl+F5). " +
      "modules/php/Game.php — main game logic (no reload needed). " +
      "modules/js/Game.js — interface logic (F5). " +
      "modules/php/States/ — State classes (no reload needed). " +
      "DEPRECATED: .view.php / .tpl (F5), material.inc.php (F5), states.inc.php (F5 or new game if breaking). " +
      "stats.json — statistics (Control Panel reload). " +
      "modules/ — additional PHP/JS included by game.php; checked into version control. " +
      "misc/ — studio-only files (checked in, 1 MB limit, not deployed to production). " +
      "Other files — not checked into source control or deployed; use modules/ for production files",
    category: "File Reference",
  },
  {
    alias: "gameinfos",
    wikiPage: "Game_meta-information:_gameinfos.inc.php",
    description:
      "gameinfos.inc.php — PHP file with game meta-information. After changes click 'Reload game informations' in Control Panel. " +
      "players: array of valid counts e.g. [2,3,4]; start with [1] during dev for easy testing. " +
      "suggest_player_number: recommended count (also caps ELO K-factor multiplier); must be set if lowest count conflicts with default options (e.g. solo mode). " +
      "not_recommend_player_number: array of discouraged counts. " +
      "player_colors: hex color array (must cover max player count); assigned in setupNewGame. " +
      "game_interface_width: see mobile docs for min/autoscale settings. " +
      "fast/medium/slow_additional_time: set high; auto-adjusted after beta launch. " +
      "tie_breaker_description: translated text shown for playerScoreAux tiebreaker. " +
      "tie_breaker_split: multiplier array for multi-level tiebreakers (e.g. [10000, 100, 1]). " +
      "losers_not_ranked: true = only winners/losers, no ranking among losers (avoid for 2-player or co-op). " +
      "disable_player_order_swap_on_rematch: true = random order instead of rotation on rematch. " +
      "is_beta: do not set to 0 before game is stabilized post-release. " +
      "coop_elo_mode: 'points_references' config mapping player counts + options to ELO reference points for cooperative games. " +
      "DEPRECATED (now in Game Metadata Manager): designer, artist, year, tags, presentation, gamepanel_page_warning, custom_buy_button",
    category: "File Reference",
  },
  {
    alias: "game_options",
    wikiPage: "Options_and_preferences:_gameoptions.json,_gamepreferences.json",
    description:
      "gameoptions.json — table-wide game variants chosen by table creator (IDs 100+). " +
      "gamepreferences.json — per-player cosmetic preferences shown in the hamburger menu (IDs 100-199). " +
      "IMPORTANT: after changes click 'Reload game options configuration' in Control Panel. " +
      "Read options in PHP: $this->bga->tableOptions->get($optionId); in JS: bga.userPreferences.get(prefId). " +
      "Option fields: name (translated), values map (name, description, tmdisplay, nobeginner, firstgameonly, beta, alpha, premium), " +
      "default, displaycondition (minplayers/maxplayers/otheroption/otheroptionisnot; operand: and|or), " +
      "startcondition (per-value conditions; gamestartonly should NOT be used), " +
      "level (base=default, major=always shown + fancy lobby featured, additional=hidden by default), " +
      "notdisplayedmessage (shown instead of hidden option). " +
      "Checkbox auto-display: 2-value options with yes/no, on/off, or enabled/disabled. " +
      "Reserved options: 200 = clock/speed mode (GAMESTATE_CLOCK_MODE), 201 = ELO/training mode (GAMESTATE_RATING_MODE). " +
      "Preference fields: name, needReload (true = auto-reload on change), values (name, cssPref = CSS class on <html>), default. " +
      "Migration: legacy gameoptions.inc.php still works; new games must use JSON. " +
      "To migrate: use 'Reload game options configuration' to auto-dump PHP to JSON, or manually remove totranslate() calls",
    category: "File Reference",
  },
  {
    alias: "translations",
    wikiPage: "Translations",
    description:
      "BGA i18n workflow: games developed in English; translation happens on the CLIENT. Never send localized strings from server. " +
      "PHP server side: clienttranslate('string') — transparent marker; tells translation engine to include the string. " +
      "Use clienttranslate() in: State class description/descriptionmyturn, material.inc.php card names, notify->all/player message strings. " +
      "DON'T concatenate with clienttranslate; DON'T pass a variable to it (string must be a literal). " +
      "For gameoptions/stats strings use totranslate() (goes to main site translation file, not game file). " +
      "Translating notify args: add 'i18n' => ['card_name'] to the args array to translate specific notification arguments. " +
      "JS client side: _('original english string') — returns translated string. " +
      "Can't use _() in constructor; use setup() instead. " +
      "bga_format() for Markdown-style bold/spans in translated strings: bga_format(_('...'), {'*': (t)=>'<b>'+t+'</b>'}). " +
      "String composition: use ${arg} substitution + args object instead of string concatenation — word order differs per language. " +
      "Style rules: no trailing period for buttons/labels/status bar; period for chained complete sentences; either OK for tooltips/logs. " +
      "Tips: reuse exact strings; use 'coin(s)' for plural/singular; use present tense ('player gets' not 'player got'); " +
      "avoid gender-specific 'their' (use 'his/her' so the pronoun replacement system can adapt). " +
      "'Check project' button in Studio runs static analysis and extracts all translation keys. " +
      "Trick: _('$locale') returns the user's current language code (e.g. 'en', 'fr')",
    category: "File Reference",
  },
  {
    alias: "game_replay",
    wikiPage: "Game_replay",
    description:
      "Game replay is handled entirely by the framework — no special replay code needed in your game. " +
      "REQUIREMENT: update the client UI exclusively through the notification system; " +
      "do NOT use ajaxcall callbacks or bgaPerformAction promise results to update UI (they won't be replayed). " +
      "How it works: static game files archived at game start; all notifications added to archive; " +
      "on replay, static files loaded + notifications resent in order to reconstruct the game. " +
      "Live replay ('replay from move #N'): g_replayFrom global is set; moves before N run in instantaneousMode (animations skipped). " +
      "Archive mode (after game ends): g_archive_mode global is true. " +
      "instantaneousMode: framework animations handle this automatically; check bgaAnimationsActive() for custom animations. " +
      "Preview videos: BGA periodically generates webm preview videos from example games. " +
      "Hide pop-up modals in preview: check URL param target=video with new URLSearchParams(window.location.search).get('target')",
    category: "File Reference",
  },

  // ── JS Components ─────────────────────────────────────────────────────────
  {
    alias: "counter",
    wikiPage: "Counter",
    description:
      "ebg/counter — built-in JS component for animated numeric counters (preloaded, no import needed). " +
      "Setup: new ebg.counter(); counter.create(targetId, settings?). " +
      "settings: { value (initial), tableCounter (auto-sync with PHP TableCounter), " +
      "playerCounter + playerId (auto-sync with PHP PlayerCounter) }. " +
      "API: getValue(), setValue(v), toValue(v) (animated from current to v), incValue(by), disable() (shows '-'). " +
      "speed: animation duration in ms (default 100). " +
      "Typical usage: create one counter per player keyed by player_id in setup() loop, " +
      "inject HTML into player panel via getPlayerBoardTemplate + insertAdjacentHTML",
    category: "JS Components",
  },
  {
    alias: "scrollmap",
    wikiPage: "Scrollmap",
    description:
      "ebg/scrollmap — JS component for an infinite/boundless scrollable game area (examples: Carcassonne, Saboteur, Takenoko). " +
      "Required HTML: #map_container > #map_scrollable, #map_surface, #map_scrollable_oversurface + arrow divs (.movetop/.moveleft/.moveright/.movedown). " +
      "Setup: scrollmap.create(container, undersurface, surface, onsurface); scrollmap.setupOnScreenArrows(step). " +
      "API: scroll(dx, dy, duration?, delay?), scrollto(x, y, duration?, delay?), disableScrolling(), enableScrolling(). " +
      "Two content layers: map_scrollable = non-clickable elements beneath pan surface; " +
      "map_scrollable_oversurface = interactive/clickable elements above pan surface. " +
      "Both scroll synchronously. map_surface fills container exactly (100% width/height, position absolute). " +
      "Touch devices: add #map_container { touch-action: none } to prevent page scroll. " +
      "Click fall-through: #map_scrollable_oversurface { pointer-events: none } + children { pointer-events: initial }. " +
      "Zoom: apply CSS transform scale() to both map_scrollable and map_scrollable_oversurface simultaneously. " +
      "Optional height extend: add #map_footer with enlarge link + dojo.connect onclick handler",
    category: "JS Components",
  },
  {
    alias: "stock",
    wikiPage: "Stock",
    description:
      "ebg/stock — JS component to display and manage a set of same-size game elements at a position. " +
      "Most widely used BGA component; used for hands, player panels, token piles, etc. " +
      "NOTE: bga-cards is now the recommended replacement for card games — prefer that for new games. " +
      "Setup: stock.create(this.bga.gameui, containerDiv, itemW, itemH); stock.addItemType(typeId, weight, imageUrl, imagePos). " +
      "image_items_per_row: columns in CSS sprite (required for multi-row sprites). " +
      "Add/remove: addToStock(type, from?), addToStockWithId(type, id, from?), " +
      "removeFromStockById(id, to?, noupdate?), removeAll(), removeAllTo(to). " +
      "Use EITHER addToStock or addToStockWithId for a given stock, never both. " +
      "Selection: setSelectionMode(0|1|2), setSelectionAppearance('border'|'disappear'|'class'), " +
      "onChangeSelection callback, getSelectedItems(), unselectAll(). " +
      "Layout: item_margin (default 5), centerItems, setOverlap(h%, v%), autowidth, resetItemsPosition(), updateDisplay(). " +
      "Customize: extraClasses, onItemCreate(div, typeId, id), onItemDelete, jstpl_stock_item template override. " +
      "Known issue: Safari background-position percentages can be slightly off (fix with background-size attribute)",
    category: "JS Components",
  },
  {
    alias: "zone",
    wikiPage: "Zone",
    description:
      "ebg/zone — JS component to organise tokens/pieces in a fixed-size area. " +
      "Unlike Stock, static width must be set in CSS (not responsive). " +
      "Setup: zone.create(this.bga.gameui, divId, itemW, itemH); zone.setPattern(mode). " +
      "Add/remove: zone.placeInZone(id, weight?), zone.removeFromZone(id, destroy?, to?), " +
      "zone.removeAll(), zone.getItemNumber(), zone.getAllItems(). " +
      "Patterns (pass to setPattern): " +
      "'grid' (default — row-wrapping when overflows width), " +
      "'diagonal' (offset stack illusion; item_margin controls depth), " +
      "'verticalfit' (single column, overlaps to fit allotted height), " +
      "'horizontalfit' (single row, overlaps to fit allotted width), " +
      "'ellipticalfit' (circular/elliptical arrangement, forms concentric rings when overflows), " +
      "'custom' (full control via itemIdToCoords function returning {x,y,w,h}). " +
      "Examples: token spots at Can't Stop (diagonal), canoes in Niagara (custom)",
    category: "JS Components",
  },
  {
    alias: "draggable",
    wikiPage: "Draggable",
    description:
      "ebg/draggable — legacy JS component for drag-and-drop interactions. " +
      "DEPRECATED/LEGACY: created before HTML5 drag support; prefer modern alternatives for new games. " +
      "Modern alternatives: " +
      "Pointer Events API (works on mobile, see Century game example + CodePen); " +
      "native HTML5 Drag and Drop API (does NOT work on mobile browsers; Chrome fires limited events). " +
      "Legacy usage: draggableObj.create(page, divId, divId); " +
      "dojo.connect events: onStartDragging(id, l, t), onDragging(id, l, t, dx, dy), onEndDragging(id, l, t, dragged). " +
      "In onEndDragging: call fromStock.resetItemsPosition() if drop is invalid; " +
      "otherwise addToStockWithId on toStock + removeFromStockById on fromStock. " +
      "See sharedcode game on BGA for full Stock+Draggable implementation example",
    category: "JS Components",
  },
  {
    alias: "bga_animations",
    wikiPage: "BgaAnimations",
    description:
      "bga-animations — modern Promise-based JS animation library. " +
      "Foundation used by bga-cards and bga-dice; load first when using those libraries. " +
      "Load: importEsmLib('bga-animations', '1.x') or legacy getLibUrl. " +
      "Setup: new BgaAnimations.Manager({ animationsActive: () => this.bga.gameui.bgaAnimationsActive() }). " +
      "Key methods: slideAndAttach(element, destDiv), displayScoring(element, score, color). " +
      "Promise-based: await in notification handlers; respects instantaneousMode (replay/archive). " +
      "Handles container scale+rotation correctly (Dojo slideToObject does not). " +
      "Uses Element.animate API under the hood. " +
      "Developer note: style animated elements with CSS class selectors, NOT id or parent-child selectors — " +
      "animations clone the element and reparent it, breaking id/parent-based styles. " +
      "TypeScript: d.ts file available at bga-animations/1.x/dist/bga-animations.d.ts. " +
      "Versioning: semver; 1.x safe for latest without breaking changes. " +
      "Example usage: Reversi game",
    category: "JS Components",
  },
  {
    alias: "bga_cards",
    wikiPage: "BgaCards",
    description:
      "bga-cards — modern JS card management library; recommended replacement for Stock in card games. " +
      "BGA wiki note: 'We recommend to use it instead of Stock'. " +
      "Load: importEsmLib('bga-cards', '1.x') — also requires bga-animations. " +
      "Setup: new BgaCards.Manager({ animationManager, type, getId, setupFrontDiv(card, div), setupBackDiv? (optional), isCardVisible? }). " +
      "isCardVisible defaults to (card) => card.type; define custom function (usually () => true for visible hands). " +
      "Stock types: LineStock, HandStock, SlotStock, CardsStack (DeckStock), VoidStock. " +
      "Key methods (many async/Promise): addCards(arr), removeCards(arr), setSelectableCards(arr), getSelectedCards(). " +
      "ASYNC GOTCHA: addCards is async but setSelectableCards is not; use setTimeout in setup()/onEnteringState to sequence correctly. " +
      "PHP Deck gotchas: getCardsInLocation returns map not array — use Object.values() in JS or array_values() in PHP; " +
      "type/type_arg from PHP are strings not numbers — cast or use remapToBgaCard helper. " +
      "Sprite markup: set backgroundPositionX/Y with calc() in setupFrontDiv, or use data-type attributes + CSS. " +
      "Two-sided cards: define setupBackDiv + custom isCardVisible for flip animations. " +
      "TypeScript: d.ts at bga-cards/1.x/dist/bga-cards.d.ts; remove last export line if needed. " +
      "Examples: Frenchtarot (JS), Verso (TypeScript), Tutorial hearts",
    category: "JS Components",
  },
  {
    alias: "bga_dice",
    wikiPage: "BgaDice",
    description:
      "bga-dice — JS component for dice display and roll animations. " +
      "Load: importEsmLib('bga-dice', '1.x') — also requires bga-animations. " +
      "Setup: new BgaDice.Manager({ animationManager, type: 'my-game-die' }). " +
      "Die objects: { id, face, location }. " +
      "Stock types: LineStock (and others matching bga-cards structure). " +
      "Key methods: addDice(arr), rollDice(arr) (async — animates roll to new face values). " +
      "Reuse the same animationManager instance as bga-cards or bga-animations if already created. " +
      "TypeScript: d.ts at bga-dice/1.x/dist/bga-dice.d.ts. " +
      "Versioning: semver; 1.x safe for latest non-breaking updates",
    category: "JS Components",
  },

  // ── PHP Components ────────────────────────────────────────────────────────
  {
    alias: "deck",
    wikiPage: "Deck",
    description:
      "PHP Deck component — server-side card/token manager; eliminates manual SQL for decks and hands. " +
      "Card has 5 properties: id (auto-generated), type (string — e.g. suit), type_arg (int — e.g. value), " +
      "location (string), location_arg (int). id/type/type_arg are constants; location/location_arg change as cards move. " +
      "Built-in special locations: 'deck' (pile, location_arg = draw order; highest = top), " +
      "'hand' (location_arg = player_id), 'discard' (used by auto-reshuffle). " +
      "DB table required: card_id, card_type, card_type_arg, card_location, card_location_arg. " +
      "HINT: use varchar(32) for card_location if player IDs appear in location (16 is too short). " +
      "Init: $this->cards = $this->deckFactory->createDeck('tablename') — call in constructor. " +
      "createCards($cards, $location='deck') — batch create; call in setupNewGame only. " +
      "Picking: pickCard(location, playerId), pickCards(nbr, location, playerId), " +
      "pickCardForLocation(from, to, arg), pickCardsForLocation(nbr, from, to, arg, noReform). " +
      "Moving: moveCard(id, location, arg=0), moveCards(ids[], location, arg=0), " +
      "insertCardOnExtremePosition(id, location, bOnTop), moveAllCardsInLocation(from, to, fromArg?, toArg?), " +
      "moveAllCardsInLocationKeepOrder(from, to), playCard(id) = insertOnTop('discard'). " +
      "Getting: getCard(id), getCardsInLocation(location, arg?, orderBy?), countCardInLocation(location, arg?), " +
      "countCardsInLocations(), countCardsByLocationArgs(location), getPlayerHand(playerId), " +
      "getCardOnTop(location), getCardsOnTop(nbr, location). " +
      "Shuffling: shuffle(location) — resets location_arg to 0..N-1. " +
      "Auto-reshuffle: $this->cards->autoreshuffle = true; callback via autoreshuffle_trigger; " +
      "custom locations via autoreshuffle_custom = ['mydeck' => 'mydiscard']",
    category: "PHP Components",
  },
  {
    alias: "player_counter",
    wikiPage: "PlayerCounter_and_TableCounter",
    description:
      "PHP PlayerCounter and TableCounter — server-side numeric counters that auto-sync to JS ebg.counter. " +
      "PlayerCounter: one value per player (e.g. money, energy, tokens). " +
      "TableCounter: one shared value for the table (e.g. round, turn, pool). " +
      "Create: $this->xxx = $this->counterFactory->createPlayerCounter('name', min=0, max=null) or createTableCounter('name'). " +
      "Built-in counters: $this->playerScore, $this->playerScoreAux — automatically update player_score/player_score_aux in DB and front panel. " +
      "initDb: call in setupNewGame — PlayerCounter.initDb(array_keys($players), initial=0); TableCounter.initDb(initial=0). " +
      "PlayerCounter API: get(playerId), set(playerId, value, message?), inc(playerId, inc, message?), " +
      "getAll(), setAll(value, message?), fillResult(&$result, fieldName?). " +
      "TableCounter API: get(), set(value, message?), inc(inc, message?), fillResult(&$result, fieldName?). " +
      "NotificationMessage auto-args sent to front: name, value, oldValue, inc, absInc (+ playerId/player_name for PlayerCounter). " +
      "JS auto-sync: pass { value, playerCounter: 'name', playerId } or { value, tableCounter: 'name' } to ebg.counter.create(). " +
      "Listen to counter updates for extra logic: notif_setPlayerCounter, notif_setTableCounter, notif_setPlayerCounterAll. " +
      "Throws: OutOfRangeCounterException (min/max violated), UnknownPlayerException (player not in initDb)",
    category: "PHP Components",
  },

  // ── Studio User Guide ─────────────────────────────────────────────────────
  {
    alias: "studio_start",
    wikiPage: "First_steps_with_BGA_Studio",
    description:
      "First steps with BGA Studio — getting your local environment connected and making your first change. " +
      "SFTP setup: configure an SFTP client (FileZilla, WinSCP, or VS Code SFTP extension) to sync files to boardgamearena.com/studio. " +
      "Creating a project: use Express Start (recommended) or manually create a game from the Control Panel. " +
      "File structure overview: which files are auto-generated vs hand-edited. " +
      "Editing workflow: edit locally → SFTP upload → Ctrl+F5 (CSS/images) or F5 (JS/PHP) to reload. " +
      "Version control: all source files belong under git; .gitignore what shouldn't be committed (node_modules, dist). " +
      "Common first-run pitfalls: blank white screen (JS/PHP syntax error — check Studio error log), " +
      "cache not clearing (Ctrl+Shift+R / hard reload), SFTP not uploading (check remote path, permissions, passive mode). " +
      "Studio URL: en.boardgamearena.com/studio",
    category: "Studio Guide",
  },
  {
    alias: "walkthrough",
    wikiPage: "Create_a_game_in_BGA_Studio:_Complete_Walkthrough",
    description:
      "Complete walkthrough: creating a game from scratch in BGA Studio, step by step. " +
      "Covers: (1) registering the game and creating the Studio project, " +
      "(2) adding board/card graphics to img/, (3) writing dbmodel.sql schema, " +
      "(4) setupNewGame() initialising players/deck/tokens and returning the first State class, " +
      "(5) getAllDatas() returning everything the client needs for a full page rebuild, " +
      "(6) defining State classes in modules/php/States/ with getArgs/onEnteringState/act* methods, " +
      "(7) sending notifications from PHP with notifyAllPlayers/notifyPlayer, " +
      "(8) handling notif_* in Game.js and updating the DOM, " +
      "(9) building the initial board DOM in JS setup() from gamedatas, " +
      "(10) JS State classes for action buttons and client state management, " +
      "(11) zombie() method for disconnected players, (12) getGameProgression(), " +
      "(13) testing with 1-player mode and the Studio debug menu, " +
      "(14) preparing the game for alpha submission. " +
      "Recommended approach: get one complete move working end-to-end before adding further states",
    category: "Studio Guide",
  },
  {
    alias: "tutorial_reversi",
    wikiPage: "Tutorial_reversi",
    description:
      "Tutorial: Reversi — the official BGA beginner tutorial, maintained by the BGA team. " +
      "Implements a complete 2-player Reversi (Othello) game demonstrating the full modern stack. " +
      "Board: HTML grid generated in JS setup() from gamedatas.board, CSS for square layout and token colours. " +
      "PHP: PlayDisc State class with actPlayDisc() validating the move and flipping opponent tokens in DB; " +
      "NextPlayer State class checking for valid moves and advancing or ending the game; " +
      "notifyAllPlayers for board updates (notif_playDisc) and score changes (notif_newScores). " +
      "State machine: ST_PLAYER_TURN → ST_NEXT_PLAYER → loop, plus ST_END_GAME. " +
      "JS: notif_playDisc handler places the new token and animates flipped tokens with bga-animations slideAndAttach; " +
      "notif_newScores updates ebg.counter score displays. " +
      "JS State class: onEnteringState highlights valid target squares; addActionButton for pass when no moves available. " +
      "Zombie mode: zombieTurn() auto-passes for a disconnected player. " +
      "Highly recommended starting point before building any real game",
    category: "Studio Guide",
  },
  {
    alias: "guidelines",
    wikiPage: "BGA_Studio_Guidelines",
    description:
      "BGA Studio coding and UX/UI guidelines that games must meet for alpha/beta/release approval. " +
      "Layout (L-1–L-8): responsive design, no horizontal scroll at standard widths, player panels always visible, " +
      "board centred, no overlapping UI elements. " +
      "Usability (U-1–U-8): always-visible whose-turn indicator, highlighted valid actions, " +
      "tooltips on all interactive elements, undo support where the rules allow. " +
      "Feedback (F-1–F-3): smooth animations for all game events, sound effects encouraged, " +
      "game log entry for every meaningful player action. " +
      "Design (D-1–D-4): no copyrighted/watermarked artwork, all interface text in English, " +
      "colour-blind-friendly (never rely on colour alone to convey information). " +
      "Accessibility (A-1–A-4): keyboard navigability, sufficient contrast ratios, " +
      "ARIA labels on interactive elements. " +
      "Technical (T-1–T-10): no console.log in production, no hardcoded player IDs, " +
      "no PHP global state across requests, all DB access via BGA helpers (not raw PDO), " +
      "no .action.php (use autowired act* State methods), PSR-4 namespacing for PHP modules, " +
      "JS templates via jstpl_ variables (not inline HTML string concatenation)",
    category: "Studio Guide",
  },
  {
    alias: "tips",
    wikiPage: "I_wish_I_knew_this_when_I_started",
    description:
      "One-liners on the most common missed features, gotchas, and time-saving tricks in BGA Studio. " +
      "Cache: always Ctrl+F5 after CSS/image changes — browser cache is persistent and bites everyone. " +
      "PHP state: no global variables survive between requests; use $this->bga->globals or DB for persistence. " +
      "getAllDatas(): every piece of state the client needs must be returned here — " +
      "called on page reload, spectator join, and player reconnect; gaps cause desynced UIs. " +
      "Actions: use bgaPerformAction('actXxx', args) not legacy ajaxcall(); " +
      "never update the UI in the action response callback — only in notif_* handlers. " +
      "Equality: use === not == in PHP when comparing DB string values (player IDs from getObjectFromDB are strings). " +
      "1-player mode: set players:[1] in gameinfos during development so you can test without a second browser tab. " +
      "Reload button: after changing stats.json or gameoptions.json you MUST click Reload in Control Panel or changes are invisible. " +
      "$this->dump('label', $var): best friend for server-side debugging — output appears directly in the game log. " +
      "Spectator testing: always open the game in an incognito window as a spectator to catch getAllDatas gaps",
    category: "Studio Guide",
  },
  {
    alias: "debugging",
    wikiPage: "Practical_debugging",
    description:
      "Practical debugging tools and techniques for BGA games in Studio. " +
      "PHP: $this->dump('label', $variable) — dumps value to the game log visible to all players at the table. " +
      "$this->debug('msg') — writes to the server error log (Control Panel → Show last PHP errors). " +
      "$this->trace('msg') — lightweight flow tracing. " +
      "Debug menu: prefix any PHP method with debug_ (e.g. debug_giveAllCards()) to expose it in Studio's debug dropdown; " +
      "wrap the method body in if ($this->getBgaEnvironment() === 'studio') to prevent production exposure. " +
      "getBgaEnvironment(): returns 'studio', 'preprod', or 'production' — gate all debug code behind 'studio'. " +
      "Save & restore state: Control Panel has 'Save current game state' / 'Restore' buttons — " +
      "invaluable for replaying a specific game scenario without replaying the whole game from scratch. " +
      "JS: browser DevTools console + debugger; breakpoints; Network tab to inspect ajaxcall payloads and PHP responses. " +
      "Identifying PHP errors: blank/spinner response usually means a PHP exception — check the Studio error log. " +
      "Notification tracing: add console.log(notif) at the top of each notif_* handler during development. " +
      "instantaneousMode: during replay, animations are skipped; guard custom animations with bgaAnimationsActive()",
    category: "Studio Guide",
  },
  {
    alias: "troubleshooting",
    wikiPage: "Troubleshooting",
    description:
      "Solutions to common 'I am really stuck' situations in BGA Studio. " +
      "Game won't start: PHP syntax error (check Studio error log), SQL error in dbmodel.sql, " +
      "setupNewGame() not returning the first State class name, or a missing required gameinfos field. " +
      "'Move recorded, waiting for update' (spinner never resolves): a notification was sent but the " +
      "matching JS notif_* handler is missing, misspelled, or threw a JS error — open DevTools console. " +
      "Zombie mode errors: zombie() method missing or failing to advance the game state — " +
      "every active-player state needs a zombie() implementation. " +
      "DB deadlocks: concurrent requests updating the same row — " +
      "restructure to a single UPDATE or add SELECT ... FOR UPDATE locking. " +
      "JS integer-as-string bugs: PHP DB integer values arrive as strings in JSON notifications — " +
      "cast with parseInt() in JS or (int) in PHP before sending. " +
      "'checkAction' error: action name mismatch between JS bgaPerformAction call and PHP State class method name. " +
      "Spectator crash: getAllDatas() returning getCurrentPlayerId() data without guarding for spectator context. " +
      "Stats/options not appearing: forgot to click 'Reload game options/informations' in Control Panel",
    category: "Studio Guide",
  },
  {
    alias: "lifecycle",
    wikiPage: "BGA_game_Lifecycle",
    description:
      "BGA game lifecycle: the stages a game passes through from creation to full public release. " +
      "Initial: project created in Studio, visible only to the developer. " +
      "Assigned: a BGA project manager is assigned to shepherd the game through review. " +
      "Pre-alpha: developer can invite specific testers via a private link for early feedback. " +
      "Alpha: submitted for BGA review — team checks guideline compliance, UI quality, rules accuracy, and game stability. " +
      "Licensed games also require publisher review and approval at this stage. " +
      "Public Beta: game opens to all BGA users; ELO enabled; appears in the game catalog. " +
      "Requires 10+ player ratings averaging ≥ 4.5 to be considered for advancement to Gold. " +
      "Gold (Full Release): promoted to full status with higher catalog visibility. " +
      "Key notes: do not set is_beta = 0 in gameinfos before the game is fully stabilised post-beta. " +
      "ELO goes live at Public Beta — the formula depends on suggest_player_number in gameinfos. " +
      "Publisher outreach: the BGA team handles contacting publishers; developers should not do this independently",
    category: "Studio Guide",
  },
  {
    alias: "faq",
    wikiPage: "Studio_FAQ",
    description:
      "BGA Studio frequently asked questions — quick answers to common developer queries. " +
      "PHP version: target PHP 8.4 (strict_types, named arguments, match, enums, fibers all available). " +
      "SFTP clients: FileZilla, WinSCP, Cyberduck, and the VS Code SFTP extension all work. " +
      "Language requirement: all code, variable names, comments, and translatable strings must be in English. " +
      "Image cache: img/ changes require Ctrl+F5 (hard reload) — browser cache is aggressive. " +
      "Stats / options not appearing after edit: must click 'Reload game options configuration' or " +
      "'Reload game informations' in Control Panel after changing stats.json, gameoptions.json, or gameinfos.inc.php. " +
      "Testing with multiple players: use Express Start with multiple browser tabs, or set players:[1] in gameinfos for solo testing. " +
      "npm/Composer packages: only pure-JS ESM libraries loadable via importEsmLib(); " +
      "no server-side Composer packages — PHP uses only BGA's built-in framework. " +
      "Payment: BGA developers are volunteers; BGA handles all publisher licensing negotiations. " +
      "Studio access: any BGA account can access Studio at en.boardgamearena.com/studio",
    category: "Studio Guide",
  },
  {
    alias: "migration",
    wikiPage: "BGA_Studio_Migration_Guide",
    description:
      "Migration guide for upgrading an existing BGA game from the legacy framework to the modern architecture. " +
      "File structure: move game.php → modules/php/Game.php; add PHP namespace (e.g. namespace Bga\\Games\\MyGame). " +
      "Remove .action.php: player actions are now autowired — any public act* method on a State class is auto-exposed as an AJAX endpoint. " +
      "State machine: replace the states.inc.php PHP array with individual State class files in modules/php/States/; " +
      "each class extends \\Bga\\GameFramework\\States\\GameState. " +
      "setupNewGame: return the first State class name (e.g. return PlayerTurn::class) instead of calling gamestate->changeStateLabel(). " +
      "Client API migration — replace all legacy/Dojo calls with the new this.bga.* namespace: " +
      "this.bga.actions.performAction (replaces ajaxcall), this.bga.notifications.setupPromiseNotifications, " +
      "this.bga.states, this.bga.players, this.bga.statusBar, this.bga.playerPanels, " +
      "this.bga.dialogs, this.bga.sounds, this.bga.images, this.bga.gameArea. " +
      "PHP 7.4 → 8.4 upgrades: typed properties, constructor promotion, match expressions, named arguments, enums. " +
      "Replace Dojo utilities with vanilla JS: dojo.place → insertAdjacentHTML, dojo.connect → addEventListener, " +
      "dojo.query → querySelectorAll, dojo.style → element.style, dojo.addClass/removeClass → classList. " +
      "A step-by-step migration checklist is available in the wiki",
    category: "Studio Guide",
  },
  {
    alias: "typescript",
    wikiPage: "Using_Typescript_and_Scss",
    description:
      "How to use TypeScript and SCSS (Dart Sass) in BGA game development as an optional local build step. " +
      "Toolchain: Rollup (bundler) + TypeScript compiler + Dart Sass — all run locally; output is plain .js/.css uploaded to Studio. " +
      "Key config files: package.json (build/watch scripts), tsconfig.json (target ESNext, moduleResolution bundler), " +
      "rollup.config.mjs (input: modules/ts/Game.ts → output: modules/js/Game.js, external BGA globals). " +
      "Type definitions: bga-framework.d.ts — community-maintained stubs for the BGA framework globals " +
      "(gamedatas shape, ebg.* components, this.bga.* sub-components); reference in tsconfig.json files array. " +
      "SFTP: add node_modules/ and dist/ to your SFTP exclude list — never upload them to Studio. " +
      "SCSS: compile partials → single .css file before upload; mirror the same file path as your game .css. " +
      "Watch mode: run tsc --watch + rollup --watch + sass --watch simultaneously for instant local rebuilds. " +
      "Strict mode: enable strict:true in tsconfig — catches null/undefined issues that are painful to track down at runtime. " +
      "Note: TypeScript is a local-only step; BGA Studio only ever sees compiled .js output. " +
      "Source maps: useful locally for debugging; omit from Studio uploads",
    category: "Studio Guide",
  },
  {
    alias: "cookbook",
    wikiPage: "BGA_Studio_Cookbook",
    description:
      "BGA Studio Cookbook — copy-paste recipes and patterns for common implementation scenarios. " +
      "DOM manipulation: create divs from jstpl_ templates via format_block(), attach with placeOnObject(), " +
      "animate with slideToObject(), remove with fadeOutAndDestroy(). " +
      "Log formatting: bgaFormatText() for Markdown-style bold/coloured game log entries; " +
      "addDecorator() to enrich notification args automatically across multiple notification types. " +
      "CSS sprites: background-image + background-position for token/card artwork from a single sprite sheet; " +
      "use background-size for zoom/resolution independence. " +
      "Drop shadows: use box-shadow not filter:drop-shadow (Safari performance regression). " +
      "DB patterns: euro-style resource tracking (extra columns on player table vs separate resource rows), " +
      "card game schema with the Deck component (type/type_arg/location/location_arg), " +
      "token placement encoded as location + location_arg. " +
      "Multi-step client states: chain JS client states to collect multiple inputs before firing a single server action. " +
      "Custom error handling: throw UserException in PHP for user-visible validation errors (shown inline, no stack trace). " +
      "Cache busting: append ?v=N to JS/CSS hrefs in the template to force a reload after production deploys. " +
      "Local storage: use window.localStorage for volatile UI preferences not worth a gamepreferences.json entry. " +
      "Undo: undoSavepoint() / undoRestorePoint() for action-level undo support",
    category: "Studio Guide",
  },
];
