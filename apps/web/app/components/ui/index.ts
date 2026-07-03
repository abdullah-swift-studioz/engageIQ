/**
 * EngageIQ UI — monochrome component library.
 *
 * Import from `~/components/ui`:
 *   import { Button, Card, Table, useToast } from '~/components/ui'
 *
 * Every component is grayscale by design. Never introduce a hue — express
 * state through shade, border weight, fills, icons, and font weight.
 * See docs/DESIGN_SYSTEM.md.
 */

export { cn } from './cn'
export type { ClassValue } from './cn'
export * as Icons from './icons'

export { Button, buttonVariants } from './Button'
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button'

export { Input } from './Input'
export type { InputProps } from './Input'
export { Textarea } from './Textarea'
export type { TextareaProps } from './Textarea'
export { Select } from './Select'
export type { SelectProps } from './Select'
export { Checkbox } from './Checkbox'
export type { CheckboxProps } from './Checkbox'
export { Radio } from './Radio'
export type { RadioProps } from './Radio'
export { Switch } from './Switch'
export type { SwitchProps } from './Switch'
export { Label } from './Label'
export type { LabelProps } from './Label'
export { FormField } from './FormField'
export type { FormFieldProps } from './FormField'

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './Card'
export {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
  TableEmpty,
} from './Table'
export type { TableEmptyProps } from './Table'

export { Badge, Tag } from './Badge'
export type { BadgeProps, BadgeVariant, BadgeSize } from './Badge'
export { StatCard } from './StatCard'
export type { StatCardProps } from './StatCard'
export { PageHeader, SectionHeader } from './PageHeader'
export type { PageHeaderProps, SectionHeaderProps } from './PageHeader'
export { EmptyState } from './EmptyState'
export type { EmptyStateProps } from './EmptyState'
export { Skeleton, SkeletonText } from './Skeleton'
export type { SkeletonProps, SkeletonTextProps } from './Skeleton'
export { Avatar } from './Avatar'
export type { AvatarProps, AvatarSize } from './Avatar'
export { Breadcrumb } from './Breadcrumb'
export type { BreadcrumbProps, BreadcrumbItem } from './Breadcrumb'
export { Pagination } from './Pagination'
export type { PaginationProps } from './Pagination'

export { Modal } from './Modal'
export type { ModalProps, ModalSize } from './Modal'
export { Drawer } from './Drawer'
export type { DrawerProps, DrawerSide, DrawerSize } from './Drawer'
export { Tabs, TabsList, TabsTrigger, TabsContent } from './Tabs'
export type { TabsProps, TabsTriggerProps, TabsContentProps } from './Tabs'
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from './DropdownMenu'
export type {
  DropdownMenuTriggerProps,
  DropdownMenuContentProps,
  DropdownMenuItemProps,
} from './DropdownMenu'
export { Tooltip } from './Tooltip'
export type { TooltipProps, TooltipSide } from './Tooltip'
export { ToastProvider, useToast } from './Toast'
export type { ToastOptions, ToastVariant } from './Toast'
