# Cashier workspace release: creamy orange

The Cashier app uses white cards, cream surfaces and warm orange actions. The updated login, navigation, payment notice, category picker and operational pages keep the existing PIN, approval, checkout, inventory and receipt workflows.

Cash remittance and Time Clock are full workspace pages. Remittance history queries the registered branch and loads 50 records at a time, with older transfers available on demand. Each record includes its recorded cashier, timestamp, amount, recipient, channel, sales period, reference and status. Submitting a remittance still uses the existing PIN verification and drawer audit.

The attendance page reads Philippine-local daily punches across branches. It pairs overnight shifts, keeps staff and branches separate, flags unmatched punches, excludes future records and avoids advertising stale clock-ins as on duty. Leaving the tab stops the live subscription and camera. Face identification, GPS checks and attendance submission remain in the existing engine.

Consumables recognize legacy image fields and matching catalogue images. Missing photos use initials. Kitchen Prep's default category comparison now uses the same lower-case normalization as inventory categories.

## Clabel CT221B

The drink-label workspace has editable dimensions, customer/order details, size/customizations and copy count. It supports PNG export at 203 dpi and actual-size browser printing through an installed printer driver. Last-receipt labels recover categories from the menu and include POS add-ons and notes. Receipt, kitchen and bar printer transports remain unchanged.

Bluetooth label printing currently uses the manufacturer's Clabel trade app: export a PNG, import it into the app and print to the paired CT221B. Direct CT221B Bluetooth commands are not implemented, and physical pairing/printing has not been verified. Manufacturer setup: https://global.ctaiot.com/app/ . Width is constrained to 25–54 mm according to the CT221B manual; the saved default is 50 × 30 mm. Users must select dimensions matching their actual label roll.

## Updates and verification

New workers download the complete app before becoming ready and wait for activation. An update notice lets cashiers finish or park orders first. Active order carts, preparation/waste/store-use drafts, checkout, attendance, remittance and printing block a reload. Updating retains photo caches, offline sales and printer settings. For the first upgrade from the old app, close all Cashier windows and reopen online after completing the current order; future releases display the in-app update notice.

Validation: 217 automated tests passed, all JavaScript and inline scripts parsed, and six checkout/inventory/shift safety modules remained byte-identical. Local fixture checks covered 1024/768/375-pixel layouts, category search, order totals, add-on selection, image aliases, remittance history, branch attendance filtering and label previews. Preview records were synthetic; no production sale, transfer, attendance punch or printer job was submitted.
