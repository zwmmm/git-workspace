import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Platform } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon, SettingsSelect } from "@getpaseo/plugin/client/ui";

type Props = {
  label: string;
  value: string;
  options: readonly { label: string; value: string }[];
  onValueChange(value: string): void;
  disabled?: boolean;
  theme: PluginSurfaceProps["theme"];
};

export function FormSelect(props: Props) {
  if (Platform.OS !== "web") {
    const { theme: _theme, ...selectProps } = props;
    return <SettingsSelect {...selectProps} />;
  }
  return <WebFormSelect {...props} />;
}

function WebFormSelect({
  label,
  value,
  options,
  onValueChange,
  disabled,
  theme,
}: Props) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  const [position, setPosition] = useState<{
    left: number;
    top?: number;
    bottom?: number;
    width: number;
    maxHeight: number;
  }>({ left: 0, top: 0, width: 0, maxHeight: 240 });
  const colors = theme.colors;

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };
  const show = () => {
    if (disabled) return;
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) {
      const below = window.innerHeight - rect.bottom - 8;
      const above = rect.top - 8;
      const height = Math.min(240, Math.max(below, above));
      const bottomSide =
        below >= Math.min(240, options.length * 32 + 8) || below >= above;
      setPosition({
        left: rect.left,
        ...(bottomSide
          ? { top: rect.bottom + 4 }
          : { bottom: window.innerHeight - rect.top + 4 }),
        width: rect.width,
        maxHeight: bottomSide ? Math.min(240, below) : height,
      });
    }
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === value)
      )
    );
    setOpen(true);
  };
  const choose = (index: number) => {
    if (disabled || !options[index]) return;
    onValueChange(options[index].value);
    close(true);
  };

  useEffect(() => {
    if (!open) return;
    if (disabled) {
      setOpen(false);
      return;
    }
    menu.current?.showPopover();
    const dismiss = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [open, disabled]);

  useEffect(() => {
    if (!open) return;
    items.current[active]?.focus();
    items.current[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const onKeyDown = (event: KeyboardEvent) => {
    const last = options.length - 1;
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(last, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(last);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(active);
    }
  };

  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}
    >
      <label
        htmlFor={id}
        style={{ color: colors.foregroundMuted, fontSize: 14 }}
      >
        {label}
      </label>
      <button
        ref={trigger}
        id={id}
        type="button"
        aria-label={label}
        popoverTarget={`${id}-menu`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onClick={(event) => {
          event.preventDefault();
          if (open) close();
          else show();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            show();
          }
        }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          boxSizing: "border-box",
          width: "100%",
          height: 32,
          padding: "5px 12px",
          borderRadius: 6,
          border: `1px solid ${
            focused || open ? colors.border : "transparent"
          }`,
          background: colors.surface2,
          color: colors.foreground,
          fontFamily: "inherit",
          fontSize: 14,
          lineHeight: "20px",
          textAlign: "left",
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? "default" : "pointer",
          outline: focused ? `2px solid ${colors.accent}` : "none",
          outlineOffset: 1,
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {options.find((option) => option.value === value)?.label ?? value}
        </span>
        <Icon name="chevron-down" size={14} color={colors.foregroundMuted} />
      </button>
      {open && !disabled ? (
        <div
          ref={menu}
          id={`${id}-menu`}
          popover="auto"
          role="listbox"
          aria-label={label}
          onToggle={(event) => {
            if (event.newState === "closed") setOpen(false);
          }}
          onKeyDown={onKeyDown}
          onBlur={(event) => {
            if (
              event.relatedTarget !== trigger.current &&
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              close();
          }}
          style={{
            position: "fixed",
            inset: "auto",
            ...position,
            margin: 0,
            boxSizing: "border-box",
            padding: 4,
            overflowY: "auto",
            borderRadius: 8,
            border: `1px solid ${colors.border}`,
            background: colors.surface1,
            color: colors.foreground,
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
          }}
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              ref={(node) => {
                items.current[index] = node;
              }}
              type="button"
              role="option"
              aria-label={option.label}
              aria-selected={option.value === value}
              tabIndex={index === active ? 0 : -1}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(index)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                minHeight: 32,
                padding: "5px 8px",
                border: 0,
                borderRadius: 6,
                cursor: "pointer",
                background: active === index ? colors.surface2 : "transparent",
                color: colors.foreground,
                fontFamily: "inherit",
                fontSize: 14,
                lineHeight: "20px",
                textAlign: "left",
                outline: "none",
              }}
            >
              <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                {option.label}
              </span>
              {option.value === value ? (
                <Icon name="check" size={14} color={colors.foregroundMuted} />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
