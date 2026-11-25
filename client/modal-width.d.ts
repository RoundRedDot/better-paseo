import "@getpaseo/plugin/client/ui";

// Remove when the SDK dependency includes the host's desktopMaxWidth property.
declare module "@getpaseo/plugin/client/ui" {
  interface ModalContentProps {
    desktopMaxWidth?: number;
  }
}
