import { cn } from '@/lib/utils'

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  // bg-accent picked up the brand orange and made loading states look like real data.
  // bg-muted reads as a neutral hollow placeholder, which is what loading should feel like.
  return (
    <div
      data-slot="skeleton"
      className={cn('bg-muted animate-pulse rounded-md', className)}
      {...props}
    />
  )
}

export { Skeleton }
