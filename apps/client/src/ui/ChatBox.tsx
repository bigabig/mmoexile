import React, { useState, useRef, useEffect } from "react";
import type { ChatChannel } from "@mmoexile/protocol";

export interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  kind: "system" | "player";
  channel: ChatChannel;
}

const CHANNEL_PREFIX: Record<ChatChannel, { label: string; color: string } | null> = {
  local: null,
  global: { label: "[Global] ", color: "#a78bfa" },
  party: { label: "[Party] ", color: "#34d399" },
};

interface ChatBoxProps {
  messages: ChatMessage[];
  isOpen: boolean;
  onSendMessage: (text: string) => void;
  onClose: () => void;
}

export const ChatBox: React.FC<ChatBoxProps> = ({
  messages,
  isOpen,
  onSendMessage,
  onClose,
}) => {
  const [inputText, setInputText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputText.trim()) {
      onSendMessage(inputText.trim());
      setInputText("");
    }
    onClose();
  };

  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        left: 16,
        width: 380,
        maxHeight: 220,
        display: "flex",
        flexDirection: "column",
        backgroundColor: isOpen
          ? "rgba(15, 23, 42, 0.9)"
          : "rgba(15, 23, 42, 0.4)",
        border: `1px solid ${isOpen ? "#475569" : "transparent"}`,
        borderRadius: 12,
        padding: 8,
        transition: "all 0.2s ease",
        pointerEvents: isOpen ? "auto" : "none",
      }}
    >
      {/* Message List */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          fontSize: 13,
          maxHeight: 160,
          paddingRight: 4,
        }}
      >
        {messages.slice(-30).map((msg) => (
          <div key={msg.id} style={{ lineHeight: 1.4 }}>
            {msg.kind === "system" ? (
              <span style={{ color: "#facc15", fontWeight: 600 }}>
                [System] {msg.text}
              </span>
            ) : (
              <span>
                {CHANNEL_PREFIX[msg.channel] && (
                  <span style={{ color: CHANNEL_PREFIX[msg.channel]!.color }}>
                    {CHANNEL_PREFIX[msg.channel]!.label}
                  </span>
                )}
                <strong style={{ color: "#38bdf8" }}>{msg.sender}: </strong>
                <span style={{ color: "#f1f5f9" }}>{msg.text}</span>
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Input */}
      {isOpen && (
        <form onSubmit={handleSubmit} style={{ marginTop: 8 }}>
          <input
            ref={inputRef}
            type="text"
            placeholder="Press Enter to send, Esc to cancel..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            style={{
              width: "100%",
              backgroundColor: "#1e293b",
              border: "1px solid #334155",
              borderRadius: 6,
              padding: "6px 10px",
              color: "#f8fafc",
              fontSize: 13,
              outline: "none",
            }}
          />
        </form>
      )}
    </div>
  );
};
