import { forwardRef, useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from './ui'

/** A password box with a show/hide toggle. Pass `className` to style a bare
 *  <input> (login pages); omit it to get the app's standard Input. */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>>(
  ({ className, ...props }, ref) => {
    const [shown, setShown] = useState(false)
    const type = shown ? 'text' : 'password'
    return (
      <div className="relative">
        {className
          ? <input ref={ref} type={type} className={`${className} pr-11`} {...props} />
          : <Input ref={ref} type={type} className="pr-11" {...props} />}
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? 'Hide password' : 'Show password'}
          title={shown ? 'Hide password' : 'Show password'}
          className="absolute right-0 top-0 h-full w-11 flex items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer"
        >
          {shown ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    )
  },
)
PasswordInput.displayName = 'PasswordInput'
