"use client";

import React, { useState, useEffect, useRef } from "react";
import { Header } from "@/components/layout/Header";
import { ChatInput } from "@/components/messages/ChatInput";
import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { startTask } from "@/utils/taskUtils";
import { Model } from "@/types";
import { TaskList } from "@/components/tasks/TaskList";
import { VncViewer } from "@/components/vnc/VncViewer";

interface FileWithBase64 {
  name: string;
  base64: string;
  type: string;
  size: number;
}

export default function Home() {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<Model | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<FileWithBase64[]>([]);
  const router = useRouter();
  const [activePopoverIndex, setActivePopoverIndex] = useState<number | null>(
    null,
  );
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/tasks/models")
      .then((res) => res.json())
      .then((data) => {
        setModels(data);
        if (data.length > 0) setSelectedModel(data[0]);
      })
      .catch((err) => console.error("Failed to load models", err));
  }, []);

  // Close popover when clicking outside or pressing ESC
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        buttonsRef.current &&
        !buttonsRef.current.contains(event.target as Node)
      ) {
        setActivePopoverIndex(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActivePopoverIndex(null);
      }
    };

    if (activePopoverIndex !== null) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [activePopoverIndex]);

  const handleSend = async () => {
    if (!input.trim()) return;

    setIsLoading(true);

    try {
      if (!selectedModel) throw new Error("No model selected");
      // Send request to start a new task
      const taskData: {
        description: string;
        model: Model;
        files?: FileWithBase64[];
      } = {
        description: input,
        model: selectedModel,
      };

      // Include files if any are uploaded
      if (uploadedFiles.length > 0) {
        taskData.files = uploadedFiles;
      }

      const task = await startTask(taskData);

      if (task && task.id) {
        // Redirect to the task page
        router.push(`/tasks/${task.id}`);
      } else {
        // Handle error
        console.error("Failed to create task");
      }
    } catch (error) {
      console.error("Error sending message:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = (files: FileWithBase64[]) => {
    setUploadedFiles(files);
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Header />

      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Desktop grid layout (left sidebar, right full desktop control) - only visible on large screens */}
        <div className="hidden h-full lg:flex">
          {/* Main content area - narrow left sidebar */}
          <div className="flex w-1/3 flex-col items-center overflow-y-auto p-8">
            <div className="flex w-full max-w-xl flex-col items-center">
              <div className="mb-6 flex w-full flex-col items-start justify-start">
                <h1 className="text-bytebot-bronze-light-12 mb-1 text-2xl">
                  What can I help you get done?
                </h1>
              </div>

              <div className="bg-bytebot-bronze-light-2 border-bytebot-bronze-light-7 mb-10 w-full rounded-2xl border p-2">
                <ChatInput
                  input={input}
                  isLoading={isLoading}
                  onInputChange={setInput}
                  onSend={handleSend}
                  onFileUpload={handleFileUpload}
                  minLines={3}
                />
                <div className="mt-2">
                  <Select
                    value={selectedModel?.name}
                    onValueChange={(val) =>
                      setSelectedModel(
                        models.find((m) => m.name === val) || null,
                      )
                    }
                  >
                    <SelectTrigger className="w-auto">
                      <SelectValue placeholder="Select a model" />
                    </SelectTrigger>
                    <SelectContent>
                      {models.map((m) => (
                        <SelectItem key={m.name} value={m.name}>
                          {m.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <TaskList
                className="w-full"
                title="Latest Tasks"
                description="You'll see tasks that are completed, scheduled, or require your attention."
              />
            </div>
          </div>

          {/* Full desktop direct control area - dominant right side */}
          <div className="flex-1 m-4 mb-8">
            <div className="border border-bytebot-bronze-light-7 rounded-lg p-4 h-full flex flex-col">
              <h3 className="text-bytebot-bronze-light-12 text-lg font-semibold mb-4 text-center">Live Control</h3>
              <div className="flex-1">
                <VncViewer viewOnly={false} />
              </div>
            </div>
          </div>
        </div>

        {/* Mobile layout - only visible on small/medium screens */}
        <div className="flex h-full flex-col lg:hidden">
          <div className="flex flex-1 flex-col items-center overflow-y-auto px-4 pt-10">
            <div className="flex w-full max-w-xl flex-col items-center pb-10">
              <div className="mb-6 flex w-full flex-col items-start justify-start">
                <h1 className="text-bytebot-bronze-light-12 mb-1 text-2xl">
                  What can I help you get done?
                </h1>
              </div>

              <div className="bg-bytebot-bronze-light-2 border-bytebot-bronze-light-5 borderw-full mb-10 rounded-2xl p-2">
                <ChatInput
                  input={input}
                  isLoading={isLoading}
                  onInputChange={setInput}
                  onSend={handleSend}
                  onFileUpload={handleFileUpload}
                  minLines={3}
                />
                <div className="mt-2">
                  <Select
                    value={selectedModel?.name}
                    onValueChange={(val) =>
                      setSelectedModel(
                        models.find((m) => m.name === val) || null,
                      )
                    }
                  >
                    <SelectTrigger className="w-auto">
                      <SelectValue placeholder="Select a model" />
                    </SelectTrigger>
                    <SelectContent>
                      {models.map((m) => (
                        <SelectItem key={m.name} value={m.name}>
                          {m.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <TaskList
                className="w-full"
                title="Latest Tasks"
                description="You'll see tasks that are completed, scheduled, or require your attention."
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
