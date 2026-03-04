import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initializeNotifications } from "./lib/notifications";

initializeNotifications();

createRoot(document.getElementById("root")!).render(<App />);
