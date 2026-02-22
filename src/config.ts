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
      "First steps with BGA Studio — environment setup and first run",
    category: "Studio Guide",
  },
  {
    alias: "walkthrough",
    wikiPage: "Create_a_game_in_BGA_Studio:_Complete_Walkthrough",
    description:
      "Complete walkthrough: creating a game from scratch in BGA Studio",
    category: "Studio Guide",
  },
  {
    alias: "tutorial_reversi",
    wikiPage: "Tutorial_reversi",
    description:
      "Tutorial: Reversi — recommended beginner tutorial maintained by BGA team",
    category: "Studio Guide",
  },
  {
    alias: "guidelines",
    wikiPage: "BGA_Studio_Guidelines",
    description: "BGA Studio coding guidelines and best practices",
    category: "Studio Guide",
  },
  {
    alias: "tips",
    wikiPage: "I_wish_I_knew_this_when_I_started",
    description: "One-liners on the most common missed features and mistakes",
    category: "Studio Guide",
  },
  {
    alias: "debugging",
    wikiPage: "Practical_debugging",
    description: "Practical tips for debugging PHP and JS in BGA Studio",
    category: "Studio Guide",
  },
  {
    alias: "troubleshooting",
    wikiPage: "Troubleshooting",
    description: "Common 'I am really stuck' situations and their solutions",
    category: "Studio Guide",
  },
  {
    alias: "lifecycle",
    wikiPage: "BGA_game_Lifecycle",
    description: "BGA game lifecycle: alpha → beta → release stages",
    category: "Studio Guide",
  },
  {
    alias: "faq",
    wikiPage: "Studio_FAQ",
    description: "BGA Studio frequently asked questions",
    category: "Studio Guide",
  },
  {
    alias: "migration",
    wikiPage: "BGA_Studio_Migration_Guide",
    description:
      "Migration guide for upgrading from older BGA Studio framework versions",
    category: "Studio Guide",
  },
  {
    alias: "typescript",
    wikiPage: "Using_Typescript_and_Scss",
    description: "How to use TypeScript and SCSS in BGA game development",
    category: "Studio Guide",
  },
  {
    alias: "cookbook",
    wikiPage: "BGA_Studio_Cookbook",
    description: "Tips for using APIs, libraries and frameworks in BGA Studio",
    category: "Studio Guide",
  },
];
