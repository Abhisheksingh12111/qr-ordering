export type TableStatus = 'free' | 'occupied';
export type SessionStatus = 'active' | 'completed';
export type OrderStatus = 'new' | 'preparing' | 'served';

export interface CafeTable {
  id: number;
  number: number;
  status: TableStatus;
}

export interface MenuItem {
  id: number;
  name: string;
  price: number;
  category: string;
  available: boolean;
}

export interface Session {
  id: string;
  customer_name: string;
  table_id: number;
  status: SessionStatus;
  created_at: string;
}

export interface OrderItem {
  id?: number;
  order_id?: number;
  item_name: string;
  price: number;
  quantity: number;
}

export interface Order {
  id: number;
  session_id: string;
  status: OrderStatus;
  created_at: string;
  order_items?: OrderItem[];
}

export interface CartItem {
  item: MenuItem;
  quantity: number;
}