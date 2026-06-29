import "./styles/shell.css";
import { ShellProvider } from "./shell/shell-context";
import { Shell } from "./shell/Shell";

export default function App() {
  return (
    <ShellProvider>
      <Shell />
    </ShellProvider>
  );
}
