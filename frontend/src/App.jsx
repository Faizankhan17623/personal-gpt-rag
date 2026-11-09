import { useEffect } from "react";
import { useDispatch } from "react-redux";
import Sidebar from "./components/Sidebar";
import ChatWindow from "./components/ChatWindow";
import { fetchChats, fetchMemories } from "./store/chatSlice";
import "./App.css";

export default function App() {
  const dispatch = useDispatch();

  useEffect(() => {
    dispatch(fetchChats());
    dispatch(fetchMemories());
  }, [dispatch]);

  return (
    <div className="app">
      <Sidebar />
      <ChatWindow />
    </div>
  );
}
