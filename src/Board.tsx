import { DragDropContext, Droppable } from "react-beautiful-dnd";
import React, { useState } from "react";
import TaskItem from "./TaskItem";
import { paramCase } from "@basementuniverse/kanbn/src/utility";
import VSCodeApi from "./VSCodeApi";
import formatDate from "dateformat";

// Called when a task item has finished being dragged
const onDragEnd = (result, columns, setColumns, vscode: VSCodeApi) => {
  // No destination means the item was dragged to an invalid location
  if (!result.destination) {
    return;
  }

  // Get the source and destination columns
  const { source, destination } = result;

  // The item that was moved
  let removed: KanbnTask;

  // The task was dragged from one column to another
  if (source.droppableId !== destination.droppableId) {
    const sourceItems = columns[source.droppableId];
    const destItems = columns[destination.droppableId];
    [removed] = sourceItems.splice(source.index, 1);
    destItems.splice(destination.index, 0, removed);
    setColumns({
      ...columns,
      [source.droppableId]: sourceItems,
      [destination.droppableId]: destItems,
    });

    // The task was dragged into the same column
  } else {
    // If the task was dragged to the same position that it currently occupies, don't move it (this will
    // prevent unnecessarily setting the task's updated date)
    if (source.index === destination.index) {
      return;
    }
    const copiedItems = columns[source.droppableId];
    [removed] = copiedItems.splice(source.index, 1);
    copiedItems.splice(destination.index, 0, removed);
    setColumns({
      ...columns,
      [source.droppableId]: copiedItems,
    });
  }

  // Post a message back to the extension so we can move the task in the index
  vscode.postMessage({
    command: "kanbn.move",
    task: removed.id,
    columnName: destination.droppableId,
    position: destination.index,
  });
};

// Check if a task's due date is in the past
const checkOverdue = (task: KanbnTask) => {
  if ("due" in task.metadata && task.metadata.due !== undefined) {
    return Date.parse(task.metadata.due) < new Date().getTime();
  }
  return false;
};

// A list of property names that can be filtered
const filterProperties = ["description", "assigned", "tag", "relation", "subtask", "comment"];

// Filter tasks according to the filter string
const filterTask = (
  task: KanbnTask,
  taskFilter: string,
  customFields: { name: string; type: "boolean" | "date" | "number" | "string" }[]
) => {
  let result = true;
  const customFieldMap = Object.fromEntries(
    customFields.map((customField) => [customField.name.toLowerCase(), customField])
  );
  const customFieldNames = Object.keys(customFieldMap);
  taskFilter.split(" ").forEach((f) => {
    const parts = f.split(":").map((p) => p.toLowerCase());

    // This filter section doesn't contain a property name
    if (parts.length === 1) {
      // Filter for overdue tasks
      if (parts[0] === "overdue") {
        if (!checkOverdue(task)) {
          result = false;
        }
        return;
      }

      // Filter boolean custom fields
      if (customFieldNames.includes(parts[0]) && customFieldMap[parts[0]].type === "boolean") {
        if (!(customFieldMap[parts[0]].name in task.metadata) || !task.metadata[customFieldMap[parts[0]].name]) {
          result = false;
        }
        return;
      }

      // Filter task id or name
      if (!task.id.toLowerCase().includes(parts[0]) && !task.name.toLowerCase().includes(parts[0])) {
        result = false;
      }
      return;
    }

    // If this filter section contains a property name and value, check the value against the property
    if (parts.length === 2 && (filterProperties.includes(parts[0]) || customFieldNames.includes(parts[0]))) {
      // Fetch the value to filter by
      let propertyValue = "";
      switch (parts[0]) {
        case "description":
          propertyValue = [task.description, ...task.subTasks.map((subTask) => subTask.text)].join(" ");
          break;
        case "assigned":
          propertyValue = task.metadata.assigned || "";
          break;
        case "tag":
          propertyValue = (task.metadata.tags || []).join(" ");
          break;
        case "relation":
          propertyValue = task.relations.map((relation) => `${relation.type} ${relation.task}`).join(" ");
          break;
        case "subtask":
          propertyValue = task.subTasks.map((subTask) => `${subTask.text}`).join(" ");
          break;
        case "comment":
          propertyValue = task.comments.map((comment) => `${comment.author} ${comment.text}`).join(" ");
          break;
        default:
          if (
            customFieldNames.includes(parts[0]) &&
            customFieldMap[parts[0]].type !== "boolean" &&
            customFieldMap[parts[0]].name in task.metadata
          ) {
            propertyValue = `${task.metadata[customFieldMap[parts[0]].name]}`;
          }
          break;
      }

      // Check the search term against the value
      if (!propertyValue.toLowerCase().includes(parts[1])) {
        result = false;
      }
      return;
    }
  });
  return result;
};

const Board = ({
  name,
  description,
  columns,
  hiddenColumns,
  startedColumns,
  completedColumns,
  columnSorting,
  customFields,
  dateFormat,
  showBurndownButton,
  showSprintButton,
  currentSprint,
  vscode,
}: {
  name: string;
  description: string;
  columns: Record<string, KanbnTask[]>;
  hiddenColumns: string[];
  startedColumns: string[];
  completedColumns: string[];
  columnSorting: { [columnName: string]: { field: string; order: "ascending" | "descending" }[] };
  customFields: { name: string; type: "boolean" | "date" | "number" | "string" }[];
  dateFormat: string;
  showBurndownButton: boolean;
  showSprintButton: boolean;
  currentSprint: KanbnSprint | null;
  vscode: VSCodeApi;
}) => {
  const [, setColumns] = useState(columns);
  const [taskFilter, setTaskFilter] = useState("");

  // Called when the clear filter button is clicked
  const clearFilters = (e) => {
    (document.querySelector(".kanbn-filter-input") as HTMLInputElement).value = "";
    filterTasks(e);
  };

  // Called when the filter form is submitted
  const filterTasks = (e) => {
    e.preventDefault();
    setTaskFilter((document.querySelector(".kanbn-filter-input") as HTMLInputElement).value);
  };

  return (
    <React.Fragment>
      <div className="kanbn-header">
        <h1 className="kanbn-header-name">
          <p>{name}</p>
          <div className="kanbn-filter">
            <form>
              <input className="kanbn-filter-input" placeholder="Filter tasks" />
              <button
                type="submit"
                className="kanbn-header-button kanbn-header-button-filter"
                onClick={filterTasks}
                title="Filter tasks"
              >
                <i className="codicon codicon-filter"></i>
              </button>
              {taskFilter && (
                <button
                  type="button"
                  className="kanbn-header-button kanbn-header-button-clear-filter"
                  onClick={clearFilters}
                  title="Clear task filters"
                >
                  <i className="codicon codicon-clear-all"></i>
                </button>
              )}
              {showSprintButton && (
                <button
                  type="button"
                  className="kanbn-header-button kanbn-header-button-sprint"
                  onClick={() => {
                    vscode.postMessage({
                      command: "kanbn.sprint",
                    });
                  }}
                  title={[
                    "Start a new sprint",
                    currentSprint
                      ? `Current sprint:\n  ${currentSprint.name}\n  Started ${formatDate(
                          currentSprint.start,
                          dateFormat
                        )}`
                      : "",
                  ].join("\n")}
                >
                  <i className="codicon codicon-rocket"></i>
                  {currentSprint ? currentSprint.name : "No sprint"}
                </button>
              )}
              {showBurndownButton && (
                <button
                  type="button"
                  className="kanbn-header-button kanbn-header-button-burndown"
                  onClick={() => {
                    vscode.postMessage({
                      command: "giraffe.kanban.burndown",
                    });
                  }}
                  title="Open burndown chart"
                >
                  <i className="codicon codicon-graph"></i>
                </button>
              )}
            </form>
          </div>
        </h1>
        <p className="kanbn-header-description">{description}</p>
      </div>
      <div className="kanbn-board">
        <DragDropContext onDragEnd={(result) => onDragEnd(result, columns, setColumns, vscode)}>
          {Object.entries(columns).map(([columnName, column]) => {
            if (hiddenColumns.indexOf(columnName) !== -1) {
              return false;
            }
            return (
              <div className={["kanbn-column", `kanbn-column-${paramCase(columnName)}`].join(" ")} key={columnName}>
                <h2 className="kanbn-column-name">
                  {startedColumns.indexOf(columnName) > -1 && <i className="codicon codicon-play"></i>}
                  {completedColumns.indexOf(columnName) > -1 && <i className="codicon codicon-check"></i>}
                  {columnName}
                  <span className="kanbn-column-count">{column.length || ""}</span>
                  <button
                    type="button"
                    className="kanbn-column-button kanbn-create-task-button"
                    title={`Create task in ${columnName}`}
                    onClick={() => {
                      vscode.postMessage({
                        command: "giraffe.kanban.addTask",
                        columnName,
                      });
                    }}
                  >
                    <i className="codicon codicon-add"></i>
                  </button>
                  {((columnIsSorted, columnSortSettings) => (
                    <button
                      type="button"
                      className={[
                        "kanbn-column-button",
                        "kanbn-sort-column-button",
                        columnIsSorted ? "kanbn-column-sorted" : null,
                      ]
                        .filter((i) => i)
                        .join(" ")}
                      title={`Sort ${columnName}${
                        columnIsSorted
                          ? `\nCurrently sorted by:\n${columnSortSettings
                              .map((sorter) => `${sorter.field} (${sorter.order})`)
                              .join("\n")}`
                          : ""
                      }`}
                      onClick={() => {
                        vscode.postMessage({
                          command: "kanbn.sortColumn",
                          columnName,
                        });
                      }}
                    >
                      <i className="codicon codicon-list-filter"></i>
                    </button>
                  ))(columnName in columnSorting, columnSorting[columnName] || [])}
                </h2>
                <div className="kanbn-column-task-list-container">
                  <Droppable droppableId={columnName} key={columnName}>
                    {(provided, snapshot) => {
                      return (
                        <div
                          {...provided.droppableProps}
                          ref={provided.innerRef}
                          className={["kanbn-column-task-list", snapshot.isDraggingOver ? "drag-over" : null]
                            .filter((i) => i)
                            .join(" ")}
                        >
                          {column
                            .filter((task) => filterTask(task, taskFilter, customFields))
                            .map((task, position) => (
                              <TaskItem
                                task={task}
                                columnName={columnName}
                                customFields={customFields}
                                position={position}
                                dateFormat={dateFormat}
                                vscode={vscode}
                              />
                            ))}
                          {provided.placeholder}
                        </div>
                      );
                    }}
                  </Droppable>
                </div>
              </div>
            );
          })}
        </DragDropContext>
      </div>
    </React.Fragment>
  );
};

export default Board;
