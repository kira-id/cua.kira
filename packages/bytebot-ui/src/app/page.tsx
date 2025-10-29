"use client";

import React, { useState, useEffect, useCallback } from "react";
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
import { startTask, fetchTasks, takeOverTask, resumeTask } from "@/utils/taskUtils";
import { Model, Task, TaskStatus, Role } from "@/types";
import { TaskList } from "@/components/tasks/TaskList";
import { DesktopContainer } from "@/components/ui/desktop-container";
import { Button } from "@/components/ui/button";
import { VirtualDesktopStatus } from "@/components/VirtualDesktopStatusHeader";
import { useWebSocket } from "@/hooks/useWebSocket";

interface FileWithBase64 {
  name: string;
  base64: string;
  type: string;
  size: number;
}

const MODEL_STORAGE_KEY = "bytebot-ui:selected-model";

export default function Home() {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<Model | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<FileWithBase64[]>([]);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [taskStatus, setTaskStatus] = useState<TaskStatus | null>(null);
  const [isInteractive, setIsInteractive] = useState(false);
  const [isLoadingDesktop, setIsLoadingDesktop] = useState(false);
  const [desktopError, setDesktopError] = useState<string | null>(null);
  const [isUpdatingControl, setIsUpdatingControl] = useState(false);
  const router = useRouter();

  const persistModelSelection = useCallback((modelName: string | null) => {
    if (typeof window === "undefined") return;

    try {
      if (modelName) {
        window.localStorage.setItem(MODEL_STORAGE_KEY, modelName);
      } else {
        window.localStorage.removeItem(MODEL_STORAGE_KEY);
      }
    } catch (storageError) {
      console.error("Failed to persist model selection", storageError);
    }
  }, []);

  const activeTaskId = activeTask?.id ?? null;

  useEffect(() => {
    fetch("/api/tasks/models")
      .then((res) => res.json())
      .then((data: Model[]) => {
        setModels(data);
        if (data.length === 0) {
          setSelectedModel(null);
          persistModelSelection(null);
          return;
        }

        let savedModelName: string | null = null;
        if (typeof window !== "undefined") {
          try {
            savedModelName = window.localStorage.getItem(MODEL_STORAGE_KEY);
          } catch (storageError) {
            console.error("Failed to read stored model selection", storageError);
          }
        }

        const savedModel =
          savedModelName != null
            ? data.find((model) => model.name === savedModelName)
            : null;

        const nextModel = savedModel ?? data[0];
        setSelectedModel(nextModel);

        const nextModelName = nextModel?.name ?? null;
        if (nextModelName !== savedModelName) {
          persistModelSelection(nextModelName);
        }
      })
      .catch((err) => console.error("Failed to load models", err));
  }, [persistModelSelection]);

  const handleModelChange = useCallback(
    (modelName: string) => {
      const model = models.find((m) => m.name === modelName) || null;
      setSelectedModel(model);
      persistModelSelection(model?.name ?? null);
    },
    [models, persistModelSelection],
  );

  const loadActiveTask = useCallback(async () => {
    setIsLoadingDesktop(true);
    setDesktopError(null);

    try {
      const activeStatuses = [TaskStatus.RUNNING, TaskStatus.NEEDS_HELP];
      const activeResult = await fetchTasks({
        limit: 1,
        statuses: activeStatuses,
      });

      let task = activeResult.tasks[0];

      if (!task) {
        const fallbackResult = await fetchTasks({ limit: 1 });
        task = fallbackResult.tasks[0];
      }

      if (task) {
        setActiveTask(task);
        setTaskStatus(task.status);
        setIsInteractive(task.control === Role.USER);
      } else {
        setActiveTask(null);
        setTaskStatus(null);
      }
    } catch (error) {
      console.error("Failed to load active task", error);
      setDesktopError("Failed to load active task");
    } finally {
      setIsLoadingDesktop(false);
    }
  }, []);

  useEffect(() => {
    loadActiveTask();
  }, [loadActiveTask]);

  const handleTaskUpdate = useCallback(
    (updatedTask: Task) => {
      if (!updatedTask) return;

      if (activeTaskId && updatedTask.id === activeTaskId) {
        setActiveTask(updatedTask);
        setTaskStatus(updatedTask.status);
        setIsInteractive(updatedTask.control === Role.USER);

        if (
          updatedTask.status === TaskStatus.COMPLETED ||
          updatedTask.status === TaskStatus.CANCELLED ||
          updatedTask.status === TaskStatus.FAILED
        ) {
          loadActiveTask();
        }
        return;
      }

      if (
        !activeTaskId &&
        (updatedTask.status === TaskStatus.RUNNING ||
          updatedTask.status === TaskStatus.NEEDS_HELP)
      ) {
        setActiveTask(updatedTask);
        setTaskStatus(updatedTask.status);
        setIsInteractive(updatedTask.control === Role.USER);
      }
    },
    [activeTaskId, loadActiveTask],
  );

  const handleTaskCreated = useCallback(
    (newTask: Task) => {
      if (!newTask) return;

      if (
        !activeTaskId &&
        (newTask.status === TaskStatus.RUNNING ||
          newTask.status === TaskStatus.NEEDS_HELP)
      ) {
        setActiveTask(newTask);
        setTaskStatus(newTask.status);
        setIsInteractive(newTask.control === Role.USER);
      }
    },
    [activeTaskId],
  );

  const handleTaskDeleted = useCallback(
    (deletedTaskId: string) => {
      if (activeTaskId && deletedTaskId === activeTaskId) {
        setActiveTask(null);
        setTaskStatus(null);
        setIsInteractive(false);
        loadActiveTask();
      }
    },
    [activeTaskId, loadActiveTask],
  );

  const { joinTask, leaveTask } = useWebSocket({
    onTaskUpdate: handleTaskUpdate,
    onTaskCreated: handleTaskCreated,
    onTaskDeleted: handleTaskDeleted,
  });

  useEffect(() => {
    if (!activeTaskId) {
      leaveTask();
      return;
    }

    joinTask(activeTaskId);
    return () => {
      leaveTask();
    };
  }, [activeTaskId, joinTask, leaveTask]);

  const handleToggleControl = useCallback(async () => {
    const nextMode = !isInteractive;
    setDesktopError(null);
    setIsInteractive(nextMode);

    if (!activeTaskId) {
      return;
    }

    setIsUpdatingControl(true);
    try {
      const updatedTask = nextMode
        ? await takeOverTask(activeTaskId)
        : await resumeTask(activeTaskId);

      if (!updatedTask) {
        throw new Error("No response from server");
      }

      setActiveTask(updatedTask);
      setTaskStatus(updatedTask.status);
      setIsInteractive(updatedTask.control === Role.USER);
    } catch (error) {
      console.error("Error toggling control:", error);
      setDesktopError(
        nextMode
          ? "Unable to take over right now. Try again in a moment."
          : "Unable to switch back to view-only right now.",
      );
      setIsInteractive(!nextMode);
    } finally {
      setIsUpdatingControl(false);
    }
  }, [activeTaskId, isInteractive]);

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

  const viewOnly = !isInteractive;

  const desktopStatus: VirtualDesktopStatus = (() => {
    if (isInteractive) return "user_control";
    if (!taskStatus) return "pending";
    if (taskStatus === TaskStatus.RUNNING) return "running";
    if (taskStatus === TaskStatus.NEEDS_HELP) return "needs_attention";
    if (taskStatus === TaskStatus.FAILED) return "failed";
    if (taskStatus === TaskStatus.CANCELLED) return "canceled";
    if (taskStatus === TaskStatus.COMPLETED) return "completed";
    return "pending";
  })();

  const controlButtonLabel = isInteractive ? "View Only" : "Take Over";

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
                    onValueChange={handleModelChange}
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

          {/* Full desktop takeover area - dominant right side */}
          <div className="flex-1 px-6 pb-4 pt-6">
            <div className="flex h-full flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-bytebot-bronze-light-12 text-lg font-semibold">
                  Live Control
                </h3>
                <Button
                  onClick={handleToggleControl}
                  variant={isInteractive ? "secondary" : "default"}
                  size="sm"
                  disabled={isUpdatingControl}
                >
                  {isUpdatingControl ? "Updating..." : controlButtonLabel}
                </Button>
              </div>

              <DesktopContainer
                className="flex-1 shadow-sm"
                viewOnly={viewOnly}
                status={desktopStatus}
              />

              {desktopError && (
                <p className="text-sm text-red-500">
                  {desktopError}
                </p>
              )}

              {!desktopError && (
                <p className="text-sm text-bytebot-bronze-light-11">
                  {isInteractive
                    ? "You currently control the desktop. Click View Only to hand control back."
                    : "You're in view-only mode. Click Take Over to interact, even without an active task."}
                </p>
              )}

              {isLoadingDesktop && (
                <p className="text-xs text-bytebot-bronze-light-10">
                  Checking desktop status...
                </p>
              )}
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

              <div className="bg-bytebot-bronze-light-2 border-bytebot-bronze-light-5 mb-10 w-full rounded-2xl border p-2">
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
                    onValueChange={handleModelChange}
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
