import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import SysTrayModule from "systray2";

const SysTray = SysTrayModule.default ?? SysTrayModule;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const icoPath = join(root, "assets", "tray-icon.ico");

function menuFor(tooltip, itemStatus, itemExit) {
  return {
    icon: icoPath,
    title: "Cursor Wake",
    tooltip,
    items: [itemStatus, itemExit],
  };
}

function noopTray() {
  return {
    async setTooltip() {},
    kill() {},
  };
}

export async function startTray({ onExit }) {
  const itemStatus = {
    title: "Cursor Wake — escutando",
    tooltip: "Escutando",
    enabled: false,
    checked: false,
  };
  const itemExit = {
    title: "Sair",
    tooltip: "Encerrar o listener",
    enabled: true,
    checked: false,
    click: () => onExit(),
  };

  try {
    const systray = new SysTray({
      menu: menuFor("Cursor Wake — escutando", itemStatus, itemExit),
      debug: false,
      copyDir: true,
    });

    systray.onClick((action) => {
      action.item?.click?.();
    });

    await systray.ready();

    return {
      async setTooltip(text) {
        itemStatus.title = text;
        try {
          await systray.sendAction({
            type: "update-menu",
            menu: menuFor(text, itemStatus, itemExit),
          });
        } catch {
          /* helper already gone */
        }
      },
      kill() {
        try {
          systray.kill(false);
        } catch {
          /* already dead */
        }
      },
    };
  } catch (error) {
    console.error(`Bandeja indisponivel: ${error.message}`);
    return noopTray();
  }
}
