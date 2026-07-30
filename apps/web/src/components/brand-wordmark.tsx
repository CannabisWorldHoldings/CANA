import Image from 'next/image';

export default function BrandWordmark({
  className = '',
  priority = false,
}: {
  className?: string;
  priority?: boolean;
}) {
  return (
    <span className={`brand-wordmark ${className}`} aria-hidden="true">
      <Image
        src="/brand/orderweeddc-on-light.png"
        alt=""
        width={900}
        height={187}
        priority={priority}
        unoptimized
        className="brand-wordmark__light"
        sizes="(max-width: 640px) 144px, 176px"
      />
      <Image
        src="/brand/orderweeddc-on-dark.png"
        alt=""
        width={900}
        height={176}
        priority={priority}
        unoptimized
        className="brand-wordmark__dark"
        sizes="(max-width: 640px) 144px, 176px"
      />
    </span>
  );
}
