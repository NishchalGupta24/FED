import { FormEvent, useState } from 'react'
import { X } from 'lucide-react'

type ModalMode = 'product' | 'customer' | 'supplier'

type ModalProps = {
  mode: ModalMode
  onClose: () => void
  onSubmit: (values: Record<string, string>) => void
}

const copy = {
  product: { title: 'Add a product', subtitle: 'Keep your catalogue ready for the next sale.', submit: 'Add product' },
  customer: { title: 'Add a customer', subtitle: 'Start a clear, searchable khata account.', submit: 'Add customer' },
  supplier: { title: 'Add a supplier', subtitle: 'Save a supplier for faster reorder conversations.', submit: 'Add supplier' },
}

export default function Modal({ mode, onClose, onSubmit }: ModalProps) {
  const [values, setValues] = useState<Record<string, string>>({})
  const text = copy[mode]
  const update = (key: string, value: string) => setValues((current) => ({ ...current, [key]: value }))
  const submit = (event: FormEvent) => { event.preventDefault(); onSubmit(values) }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <form className="modal" onSubmit={submit}>
      <div className="modal-head"><div><span className="section-kicker">Quick setup</span><h2>{text.title}</h2><p>{text.subtitle}</p></div><button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
      {mode === 'product' && <div className="form-grid"><label>Product name<input required placeholder="e.g. Amul Milk" onChange={(event) => update('name', event.target.value)} /></label><label>Category<select required defaultValue="" onChange={(event) => update('category', event.target.value)}><option value="" disabled>Choose category</option><option>Staples</option><option>Snacks</option><option>Beverages</option><option>Cooking oil</option></select></label><label>Sell price<input required type="number" min="0" placeholder="0" onChange={(event) => update('price', event.target.value)} /></label><label>Opening stock<input required type="number" min="0" placeholder="0" onChange={(event) => update('stock', event.target.value)} /></label><label>Low-stock threshold<input required type="number" min="0" placeholder="10" onChange={(event) => update('threshold', event.target.value)} /></label><label>Unit<input required placeholder="e.g. 1 litre" onChange={(event) => update('unit', event.target.value)} /></label></div>}
      {mode === 'customer' && <div className="form-grid"><label>Customer name<input required placeholder="Full name or business" onChange={(event) => update('name', event.target.value)} /></label><label>Phone number<input required type="tel" placeholder="98765 43210" onChange={(event) => update('phone', event.target.value)} /></label><label>Opening balance<input type="number" min="0" defaultValue="0" placeholder="0" onChange={(event) => update('balance', event.target.value)} /></label></div>}
      {mode === 'supplier' && <div className="form-grid"><label>Supplier name<input required placeholder="Business name" onChange={(event) => update('name', event.target.value)} /></label><label>Phone number<input type="tel" placeholder="98765 43210" onChange={(event) => update('phone', event.target.value)} /></label><label>Products supplied<input placeholder="e.g. Atta, oil, rice" onChange={(event) => update('products', event.target.value)} /></label></div>}
      <div className="modal-actions"><button type="button" className="outline-btn" onClick={onClose}>Cancel</button><button className="primary-btn" type="submit">{text.submit}</button></div>
    </form>
  </div>
}
