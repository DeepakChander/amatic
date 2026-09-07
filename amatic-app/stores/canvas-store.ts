/**
 * Canvas Store - Central state management for canvas data
 */

export interface CanvasElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  [key: string]: any;
}

export interface CanvasState {
  elements: CanvasElement[];
  selectedIds: string[];
  viewportX: number;
  viewportY: number;
  zoom: number;
}

class CanvasStore {
  private state: CanvasState = {
    elements: [],
    selectedIds: [],
    viewportX: 0,
    viewportY: 0,
    zoom: 1,
  };
  
  private listeners: Array<(state: CanvasState) => void> = [];
  
  getState(): CanvasState {
    return { ...this.state };
  }
  
  setState(updates: Partial<CanvasState>): void {
    this.state = { ...this.state, ...updates };
    this.notifyListeners();
  }
  
  subscribe(listener: (state: CanvasState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
  
  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener(this.state));
  }
  
  // Element operations
  addElement(element: CanvasElement): void {
    this.state.elements.push(element);
    this.notifyListeners();
  }
  
  removeElement(id: string): void {
    this.state.elements = this.state.elements.filter((el) => el.id !== id);
    this.notifyListeners();
  }
  
  updateElement(id: string, updates: Partial<CanvasElement>): void {
    const index = this.state.elements.findIndex((el) => el.id === id);
    if (index >= 0) {
      this.state.elements[index] = { ...this.state.elements[index], ...updates };
      this.notifyListeners();
    }
  }
}

export const canvasStore = new CanvasStore();
