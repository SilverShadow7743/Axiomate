import IntakeFormClient from './IntakeFormClient'

/**
 * The public capture page.
 *
 * Two rules, both load-bearing:
 *
 *  - **It loads nothing from the workspace.** No session check, no `loadWorkspace`, no model —
 *    so there is nothing here to leak. The firm's no-login rule bends for capture, never for
 *    disclosure, and the way to be sure a page discloses nothing is for it to hold nothing.
 *
 *  - **The token is not validated at render time.** A page that answered "valid" or "not" on
 *    load would be an oracle for probing the token space, with a fast signal. Any path renders
 *    the same form; the answer arrives on submit, where an unknown token and a disabled form
 *    are the same sentence.
 */
export default async function IntakeFormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <IntakeFormClient token={token} />
}
