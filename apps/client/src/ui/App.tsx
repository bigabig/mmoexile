import React, { useState, useRef, useEffect } from "react";
import { GameApp } from "../engine/GameApp.js";
import { HUD } from "./HUD.js";
import { Minimap } from "./Minimap.js";
import { ChatBox, ChatMessage } from "./ChatBox.js";
import { QuickJoinModal } from "./QuickJoinModal.js";
import { AccountClient } from "../net/accountClient.js";
import type { KickReason } from "@mmoexile/protocol";

const KICK_MESSAGES: Record<KickReason, string> = {
  logged_in_elsewhere: "You logged in from somewhere else.",
  server_shutdown: "The server is restarting. Please join again in a moment.",
  invalid_ticket: "Your session expired. Please join again.",
  version_mismatch: "The game was updated. Please reload the page.",
  character_unavailable: "This character can't be played (dead or deleted).",
};
import { PermadeathModal } from "./components/PermadeathModal.js";
import { CharacterSheetModal } from "./components/CharacterSheetModal.js";
import { InventoryModal } from "./components/InventoryModal.js";
import { LootBagModal } from "./components/LootBagModal.js";
import { PlayerEquipment } from "@mmoexile/game-core";
import { EntityState } from "@mmoexile/protocol";

export const App: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameAppRef = useRef<GameApp | null>(null);

  const [joined, setJoined] = useState(false);
  const [nickname, setNickname] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [loadingZone, setLoadingZone] = useState<string | null>(null);
  const accountRef = useRef(new AccountClient());
  const [hp, setHp] = useState(100);
  const [maxHp, setMaxHp] = useState(100);
  const [mp, setMp] = useState(50);
  const [maxMp, setMaxMp] = useState(50);
  const [level, setLevel] = useState(1);
  const [xp, setXp] = useState(0);
  const [nextLevelXp, setNextLevelXp] = useState(100);
  const [className, setClassName] = useState("Wizard");
  const [defense, setDefense] = useState(0);
  const [equipment, setEquipment] = useState<PlayerEquipment>({
    weapon: null,
    armor: null,
  });
  const [inventory, setInventory] = useState<(string | null)[]>(
    new Array(8).fill(null),
  );
  const [worldName, setWorldName] = useState("Nexus Hub");
  const [portalPrompt, setPortalPrompt] = useState<string | null>(null);
  const [nearbyLootBag, setNearbyLootBag] = useState<EntityState | null>(null);
  const nearbyLootBagRef = useRef<EntityState | null>(null);

  const [isCharacterOpen, setIsCharacterOpen] = useState(false);
  const [isInventoryOpen, setIsInventoryOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isOffCenter, setIsOffCenter] = useState(true);
  const [isDead, setIsDead] = useState(false);

  // Entities and local position for minimap
  const [minimapState, setMinimapState] = useState<{
    pos: { x: number; y: number };
    entities: any[];
  }>({ pos: { x: 20, y: 20 }, entities: [] });

  useEffect(() => {
    if (!canvasRef.current) return;

    const gameApp = new GameApp(canvasRef.current, {
      onHpChange: (newHp, newMaxHp) => {
        setHp(newHp);
        setMaxHp(newMaxHp);
      },
      onMpChange: (newMp, newMaxMp) => {
        setMp(newMp);
        setMaxMp(newMaxMp);
      },
      onStatsChange: (stats) => {
        setLevel(stats.level);
        setClassName(stats.classId);
        setDefense(stats.defense);
        if (stats.xp !== undefined) setXp(stats.xp);
        if (stats.nextLevelXp !== undefined) setNextLevelXp(stats.nextLevelXp);
        if (stats.equipment !== undefined) setEquipment(stats.equipment);
        if (stats.inventory !== undefined) setInventory(stats.inventory);
      },
      onWorldChange: (name) => {
        setWorldName(name);
      },
      onPortalPrompt: (name) => {
        setPortalPrompt(name);
      },
      onNearbyLootBag: (bag) => {
        nearbyLootBagRef.current = bag;
        setNearbyLootBag(bag);
        if (gameAppRef.current) {
          gameAppRef.current.inputMgr.isLootModalOpen = !!bag;
        }
      },
      onChat: (sender, text, kind, channel) => {
        setChatMessages((prev) => [
          ...prev,
          { id: Math.random().toString(), sender, text, kind, channel },
        ]);
      },
      onDeath: () => {
        setIsDead(true);
      },
      onLoading: (zoneId) => {
        setLoadingZone(zoneId);
      },
      onKicked: (reason) => {
        setNotice(KICK_MESSAGES[reason]);
        setJoined(false);
      },
    });

    gameAppRef.current = gameApp;

    // Chat open handler from InputManager
    gameApp.inputMgr.onOpenChat = () => {
      setIsChatOpen(true);
      gameApp.inputMgr.isChatFocused = true;
    };

    // Modal & shortcut handlers from InputManager
    gameApp.inputMgr.onToggleCharacterSheet = () => {
      setIsCharacterOpen((prev) => !prev);
    };

    gameApp.inputMgr.onToggleInventory = () => {
      setIsInventoryOpen((prev) => !prev);
    };

    gameApp.inputMgr.onCloseModals = () => {
      setIsCharacterOpen(false);
      setIsInventoryOpen(false);
    };

    gameApp.inputMgr.onLootFirst = () => {
      if (nearbyLootBagRef.current) {
        gameApp.lootItem(nearbyLootBagRef.current.id, 0);
      }
    };

    gameApp.inputMgr.onLootAll = () => {
      if (nearbyLootBagRef.current) {
        gameApp.lootAll(nearbyLootBagRef.current.id);
      }
    };

    gameApp.start();

    // Minimap update loop interval
    const minimapInterval = setInterval(() => {
      if (gameAppRef.current) {
        setMinimapState({
          pos: {
            x: gameAppRef.current.networkMgr.localPos.x,
            y: gameAppRef.current.networkMgr.localPos.y,
          },
          entities: gameAppRef.current.entityMgr.getAllEntities(),
        });
      }
    }, 100);

    return () => {
      clearInterval(minimapInterval);
      gameApp.dispose();
    };
  }, []);

  const handleJoin = async (chosenNick: string) => {
    setJoining(true);
    setNotice(null);
    try {
      const account = accountRef.current;
      const { nickname: accountName } = await account.signIn(chosenNick);
      const { url, ticket } = await account.quickPlay();
      setNickname(accountName);
      setJoined(true);
      gameAppRef.current?.connect(url, ticket);
    } catch (err) {
      setNotice(
        `Could not join: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setJoining(false);
    }
  };

  const handleSendMessage = (text: string) => {
    gameAppRef.current?.networkMgr.sendChat(text);
  };

  const handleCloseChat = () => {
    setIsChatOpen(false);
    if (gameAppRef.current) {
      gameAppRef.current.inputMgr.isChatFocused = false;
    }
  };

  const handleToggleOffCenter = () => {
    gameAppRef.current?.cameraCtrl.toggleOffCenter();
    setIsOffCenter((prev) => !prev);
  };

  const handleInteract = () => {
    gameAppRef.current?.networkMgr.sendInteract();
  };

  const handleLootItem = (bagId: string, itemIndex: number) => {
    gameAppRef.current?.lootItem(bagId, itemIndex);
  };

  const handleLootAll = (bagId: string) => {
    gameAppRef.current?.lootAll(bagId);
  };

  const handleEquipItem = (
    inventoryIndex: number,
    slot: "weapon" | "armor",
  ) => {
    gameAppRef.current?.equipItem(inventoryIndex, slot);
  };

  const handleUnequipItem = (
    slot: "weapon" | "armor",
    targetInventoryIndex?: number,
  ) => {
    gameAppRef.current?.unequipItem(slot, targetInventoryIndex);
  };

  const handleSwapInventorySlots = (fromIndex: number, toIndex: number) => {
    gameAppRef.current?.swapInventorySlots(fromIndex, toIndex);
  };

  const handleDropItem = (
    fromSlot: "inventory" | "weapon" | "armor",
    inventoryIndex?: number,
  ) => {
    gameAppRef.current?.dropItem(fromSlot, inventoryIndex);
  };

  const handleRevive = () => {
    setIsDead(false);
    window.location.reload();
  };

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />

      {!joined && (
        <QuickJoinModal onJoin={handleJoin} notice={notice} busy={joining} />
      )}

      {joined && loadingZone && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 90,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(9, 13, 22, 0.92)",
            color: "#e2e8f0",
            fontSize: 18,
            letterSpacing: "0.08em",
          }}
        >
          Entering {loadingZone.replace(/_/g, " ")}…
        </div>
      )}

      {joined && (
        <>
          <HUD
            hp={hp}
            maxHp={maxHp}
            mp={mp}
            maxMp={maxMp}
            worldName={worldName}
            portalPrompt={portalPrompt}
            nickname={nickname}
            isOffCenter={isOffCenter}
            onToggleOffCenter={handleToggleOffCenter}
            onInteract={handleInteract}
            level={level}
            className={className}
            defense={defense}
            isCharacterOpen={isCharacterOpen}
            isInventoryOpen={isInventoryOpen}
            onToggleCharacterSheet={() => setIsCharacterOpen((prev) => !prev)}
            onToggleInventory={() => setIsInventoryOpen((prev) => !prev)}
          />

          <Minimap
            map={gameAppRef.current?.networkMgr.currentMap || null}
            localPos={minimapState.pos}
            entities={minimapState.entities}
          />

          <ChatBox
            messages={chatMessages}
            isOpen={isChatOpen}
            onSendMessage={handleSendMessage}
            onClose={handleCloseChat}
          />

          {/* Character Sheet Modal (Left Side) */}
          {isCharacterOpen && (
            <CharacterSheetModal
              nickname={nickname}
              className={className}
              level={level}
              xp={xp}
              nextLevelXp={nextLevelXp}
              hp={hp}
              maxHp={maxHp}
              mp={mp}
              maxMp={maxMp}
              defense={defense}
              equipment={equipment}
              onClose={() => setIsCharacterOpen(false)}
            />
          )}

          {/* Inventory & Gear Modal (Right Side) */}
          {isInventoryOpen && (
            <InventoryModal
              equipment={equipment}
              inventory={inventory}
              onEquipItem={handleEquipItem}
              onUnequipItem={handleUnequipItem}
              onSwapInventorySlots={handleSwapInventorySlots}
              onDropItem={handleDropItem}
              onClose={() => setIsInventoryOpen(false)}
            />
          )}

          {/* Loot Bag Modal (Bottom Center) */}
          {nearbyLootBag && (
            <LootBagModal
              bag={nearbyLootBag}
              onLootItem={handleLootItem}
              onLootAll={handleLootAll}
            />
          )}
        </>
      )}

      {/* Permadeath Modal */}
      {isDead && <PermadeathModal onRevive={handleRevive} />}
    </div>
  );
};
